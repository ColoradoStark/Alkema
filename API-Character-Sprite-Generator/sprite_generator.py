"""
Sprite generation service using direct image composition with Pillow.
Database-driven sprite generation with layer compositing.
"""

import os
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from PIL import Image
import io
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from models import Item, ItemLayer, ItemLayerBodyType, ItemVariant, Animation, item_animations, CustomAnimation, CustomAnimationFrame
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING)

SPRITE_BASE_PATH = "/generator/spritesheets"
if not os.path.exists(SPRITE_BASE_PATH):
    SPRITE_BASE_PATH = "../Universal-LPC-Spritesheet-Character-Generator/spritesheets"

SPRITE_WIDTH = 64
SPRITE_HEIGHT = 64
SHEET_COLUMNS = 13
SHEET_ROWS = 53
FULL_WIDTH = SPRITE_WIDTH * SHEET_COLUMNS   # 832
FULL_HEIGHT = SPRITE_HEIGHT * SHEET_ROWS     # 3392

# Animation layout: (name, start_row, num_rows)
ANIMATIONS = [
    ('spellcast', 0, 4),
    ('thrust', 4, 4),
    ('walk', 8, 4),
    ('slash', 12, 4),
    ('shoot', 16, 4),
    ('hurt', 20, 1),
    ('climb', 21, 1),
    ('idle', 22, 4),
    ('jump', 26, 4),
    ('sit', 30, 4),
    ('emote', 34, 4),
    ('run', 38, 4),
    ('combat_idle', 42, 4),
    ('backslash', 46, 4),
    ('halfslash', 50, 3),
]

# Standard animation row lookup
DIRECTION_OFFSETS = {'n': 0, 'w': 1, 's': 2, 'e': 3}

ANIMATION_ROWS = {}
for _anim_name, _start_row, _num_rows in ANIMATIONS:
    ANIMATION_ROWS[_anim_name] = _start_row

# Cache for loaded sprite images to avoid repeated disk reads within a single generation
_path_exists_cache: Dict[str, bool] = {}


class SpriteGenerator:
    """Generates character spritesheets by compositing layers from the database."""

    def __init__(self, session: Session):
        self.session = session
        self._image_cache: Dict[str, Image.Image] = {}

    def generate_spritesheet(
        self,
        body_type: str,
        selected_items: List[Dict[str, str]],
    ) -> Tuple[bytes, Dict]:
        """
        Generate a complete spritesheet for a character.

        Returns:
            Tuple of (PNG image bytes, custom_animations layout metadata)
        """
        layers_to_draw = self._get_layers_to_draw(body_type, selected_items)
        layers_to_draw.sort(key=lambda x: x['z_pos'] if x['z_pos'] is not None else 0)

        spritesheet = Image.new('RGBA', (FULL_WIDTH, FULL_HEIGHT), (0, 0, 0, 0))

        for layer_info in layers_to_draw:
            if layer_info['layer'].custom_animation:
                continue  # handled separately below
            self._composite_layer(spritesheet, layer_info, body_type, selected_items)

        # Render custom/oversized animations below standard grid
        custom_anims = self._get_custom_animations_needed(selected_items)
        spritesheet, custom_layout = self._render_custom_animations(
            spritesheet, body_type, selected_items, custom_anims,
        )

        output = io.BytesIO()
        spritesheet.save(output, format='PNG', optimize=False)
        return output.getvalue(), custom_layout

    def _composite_layer(
        self,
        target: Image.Image,
        layer_info: Dict,
        body_type: str,
        selected_items: List[Dict[str, str]],
    ) -> None:
        """Composite a single layer's animations directly onto the target canvas."""
        for animation_name, start_row, num_rows in ANIMATIONS:
            sprite_path = self._resolve_animation_path(layer_info, body_type, animation_name)

            if not os.path.exists(sprite_path):
                continue

            try:
                anim_image = self._load_image(sprite_path)

                y_position = start_row * SPRITE_HEIGHT

                # Paste onto a temporary same-size canvas for alpha_composite
                # (only the region that matters)
                anim_h = anim_image.size[1]
                region_h = min(anim_h, num_rows * SPRITE_HEIGHT)

                # Crop the target region, composite, paste back
                box = (0, y_position, FULL_WIDTH, y_position + region_h)
                region = target.crop(box)
                anim_crop = anim_image.crop((0, 0, min(anim_image.size[0], FULL_WIDTH), region_h))

                # Ensure same size
                if anim_crop.size != region.size:
                    tmp = Image.new('RGBA', region.size, (0, 0, 0, 0))
                    tmp.paste(anim_crop, (0, 0), anim_crop)
                    anim_crop = tmp

                composited = Image.alpha_composite(region, anim_crop)
                target.paste(composited, (0, y_position))

            except Exception:
                pass

    def _get_custom_animations_needed(
        self,
        selected_items: List[Dict[str, str]],
    ) -> Dict[str, 'CustomAnimation']:
        """Determine which custom animations are needed based on selected items."""
        item_names = [s['item'] for s in selected_items]
        if not item_names:
            return {}

        layers = (
            self.session.query(ItemLayer)
            .join(Item)
            .filter(Item.file_name.in_(item_names))
            .filter(ItemLayer.custom_animation.isnot(None))
            .all()
        )

        custom_anim_names = {layer.custom_animation for layer in layers}
        if not custom_anim_names:
            return {}

        custom_anims = (
            self.session.query(CustomAnimation)
            .options(joinedload(CustomAnimation.frames))
            .filter(CustomAnimation.name.in_(custom_anim_names))
            .all()
        )

        return {ca.name: ca for ca in custom_anims}

    def _resolve_custom_animation_path(self, layer_info: Dict, body_type: str) -> Optional[str]:
        """
        Resolve the sprite path for a custom animation layer.

        Custom animation layers point directly to the animation directory
        (e.g. weapon/blunt/flail/attack_slash/). The sprite file is
        {path}/{variant}.png — no animation subdirectory is appended.
        """
        sprite_path = layer_info['sprite_path']
        item = layer_info['item']
        variant = layer_info.get('variant')

        # Handle template replacements
        if item.replace_in_path:
            for key, value in item.replace_in_path.items():
                placeholder = f"${{{key}}}"
                if placeholder in sprite_path:
                    if isinstance(value, dict):
                        replacement = value.get(variant) if variant else value.get('default', '')
                    else:
                        replacement = value if value else ''
                    if replacement is None:
                        replacement = ''
                    sprite_path = sprite_path.replace(placeholder, str(replacement))

        sprite_path = sprite_path.rstrip('/')

        if variant:
            sprite_path = f"{sprite_path}/{variant}.png"
        else:
            sprite_path = f"{sprite_path}.png"

        return os.path.join(SPRITE_BASE_PATH, sprite_path)

    def _render_custom_animations(
        self,
        spritesheet: Image.Image,
        body_type: str,
        selected_items: List[Dict[str, str]],
        custom_anims: Dict[str, 'CustomAnimation'],
    ) -> Tuple[Image.Image, Dict[str, Dict]]:
        """Render oversized/custom animations below the standard grid."""
        if not custom_anims:
            return spritesheet, {}

        layers_to_draw = self._get_layers_to_draw(body_type, selected_items)
        layout_meta = {}
        current_y = FULL_HEIGHT

        for anim_name, ca in sorted(custom_anims.items()):
            fs = ca.frame_size
            section_width = fs * ca.num_frames
            section_height = fs * ca.num_directions

            new_width = max(spritesheet.size[0], section_width)
            new_height = current_y + section_height

            if new_width > spritesheet.size[0] or new_height > spritesheet.size[1]:
                expanded = Image.new('RGBA', (new_width, new_height), (0, 0, 0, 0))
                expanded.paste(spritesheet, (0, 0))
                spritesheet = expanded

            # Get layers that reference this custom animation
            custom_layers = [
                l for l in layers_to_draw
                if l['layer'].custom_animation == anim_name
            ]
            custom_layers.sort(key=lambda x: x['z_pos'] if x['z_pos'] is not None else 0)

            # Build frame mapping from DB
            frame_map = {}
            for frame in ca.frames:
                key = (frame.direction_index, frame.frame_index)
                frame_map[key] = (frame.source_animation, frame.source_direction, frame.source_frame)

            # Load custom layer sprites — these are already at frame_size resolution
            # (e.g. 1152x768 for 192px*6 frames x 192px*4 dirs)
            # The sprite path points directly to the animation directory,
            # so we just append /{variant}.png (no animation subdirectory).
            loaded_layers = []
            for layer_info in custom_layers:
                sprite_path = self._resolve_custom_animation_path(
                    layer_info, body_type
                )
                if not sprite_path or not os.path.exists(sprite_path):
                    continue
                try:
                    loaded_layers.append(self._load_image(sprite_path))
                except Exception:
                    pass

            # Render each frame by extracting fs x fs regions from loaded sprites
            for dir_idx in range(ca.num_directions):
                for frame_idx in range(ca.num_frames):
                    dest_x = frame_idx * fs
                    dest_y = current_y + dir_idx * fs

                    frame_canvas = Image.new('RGBA', (fs, fs), (0, 0, 0, 0))

                    for src_image in loaded_layers:
                        sx = frame_idx * fs
                        sy = dir_idx * fs

                        if sx + fs <= src_image.size[0] and sy + fs <= src_image.size[1]:
                            src_frame = src_image.crop((sx, sy, sx + fs, sy + fs))
                            frame_canvas = Image.alpha_composite(frame_canvas, src_frame)

                    spritesheet.paste(frame_canvas, (dest_x, dest_y), frame_canvas)

            layout_meta[anim_name] = {
                'y_offset': current_y,
                'frame_size': fs,
                'num_frames': ca.num_frames,
                'num_directions': ca.num_directions,
            }
            current_y += section_height

        return spritesheet, layout_meta

    def get_animation_coverage(
        self,
        selected_items: List[Dict[str, str]],
    ) -> Dict[str, Dict]:
        """
        Get per-animation coverage info: whether standard sprites exist
        and which oversized variant is available.
        """
        item_names = [s['item'] for s in selected_items]
        if not item_names:
            return {}

        items = (
            self.session.query(Item)
            .options(joinedload(Item.animations))
            .filter(Item.file_name.in_(item_names))
            .all()
        )
        standard_anims = set()
        for item in items:
            for anim in item.animations:
                standard_anims.add(anim.name)

        custom_anim_names = set()
        layers = (
            self.session.query(ItemLayer)
            .join(Item)
            .filter(Item.file_name.in_(item_names))
            .filter(ItemLayer.custom_animation.isnot(None))
            .all()
        )
        for layer in layers:
            custom_anim_names.add(layer.custom_animation)

        custom_anims = (
            self.session.query(CustomAnimation)
            .options(joinedload(CustomAnimation.frames))
            .filter(CustomAnimation.name.in_(custom_anim_names))
            .all()
        ) if custom_anim_names else []

        oversized_map = {}
        for ca in custom_anims:
            if ca.frames:
                base_anim = ca.frames[0].source_animation
                oversized_map[base_anim] = ca.name

        coverage = {}
        for anim_name, _, _ in ANIMATIONS:
            coverage[anim_name] = {
                'standard': anim_name in standard_anims,
                'oversized': oversized_map.get(anim_name),
            }

        return coverage

    def _load_image(self, path: str) -> Image.Image:
        """Load an image with caching."""
        if path not in self._image_cache:
            self._image_cache[path] = Image.open(path).convert('RGBA')
        return self._image_cache[path]

    def _resolve_animation_path(self, layer_info: Dict, body_type: str, animation: str) -> str:
        """Resolve the path for a specific animation of a layer."""
        sprite_path = layer_info['sprite_path']
        variant = layer_info.get('variant')
        item = layer_info['item']

        # Handle template replacements
        if item.replace_in_path:
            for key, value in item.replace_in_path.items():
                placeholder = f"${{{key}}}"
                if placeholder in sprite_path:
                    if isinstance(value, dict):
                        replacement = value.get(variant) if variant else value.get('default', '')
                    else:
                        replacement = value if value else ''
                    if replacement is None:
                        replacement = ''
                    sprite_path = sprite_path.replace(placeholder, str(replacement))

        # Remove trailing slash
        sprite_path = sprite_path.rstrip('/')

        # Build the path with animation subdirectory
        if variant:
            sprite_path = f"{sprite_path}/{animation}/{variant}.png"
        else:
            sprite_path = f"{sprite_path}/{animation}.png"

        return os.path.join(SPRITE_BASE_PATH, sprite_path)

    def _get_layers_to_draw(
        self,
        body_type: str,
        selected_items: List[Dict[str, str]],
    ) -> List[Dict]:
        """Get all layers that need to be drawn for the selected items."""
        # Batch-load all needed items in one query
        item_names = [s['item'] for s in selected_items]
        items = (
            self.session.query(Item)
            .options(
                joinedload(Item.layers).joinedload(ItemLayer.body_types),
                joinedload(Item.variants),
                joinedload(Item.tags),
            )
            .filter(Item.file_name.in_(item_names))
            .all()
        )
        item_map = {i.file_name: i for i in items}

        # Determine body color from selections (for match_body_color items)
        body_color = None
        for sel in selected_items:
            if sel.get('type') == 'body' and sel.get('variant'):
                body_color = sel['variant']
                break

        layers = []
        for selection in selected_items:
            item = item_map.get(selection['item'])
            if not item:
                continue

            # Determine variant: if match_body_color, use body's color
            variant = selection.get('variant')
            if item.match_body_color and body_color:
                variant = body_color

            for layer in item.layers:
                body_type_layer = next(
                    (bt for bt in layer.body_types if bt.body_type == body_type),
                    None,
                )
                if body_type_layer:
                    layers.append({
                        'item': item,
                        'layer': layer,
                        'body_type_layer': body_type_layer,
                        'z_pos': layer.z_pos,
                        'variant': variant,
                        'match_body_color': item.match_body_color,
                        'sprite_path': body_type_layer.sprite_path,
                    })

        return layers

    # ------------------------------------------------------------------
    # Animation support
    # ------------------------------------------------------------------

    # Item types where missing animations make the character look visibly broken.
    # Body/clothing missing = naked character.
    # Accessories, face expressions, belts, capes, etc. are non-critical.
    # Core clothing that would leave the character visibly naked if missing.
    # Armor accessories (arms, bracers, shoulders, bauldron, wrists) only have
    # 6 combat animations and are overlays — not critical.
    CRITICAL_TYPES = {
        'body', 'head', 'clothes', 'legs', 'dress', 'dress_sleeves',
        'armour', 'chainmail', 'jacket', 'overalls', 'vest', 'sleeves',
        'shoes', 'gloves',
    }

    # Weapons/shields are only critical for combat animations — missing weapon
    # during walk/idle is fine, but missing during slash/shoot = wrong weapon motion.
    WEAPON_TYPES = {'weapon', 'shield'}
    # Spellcast looks fine without a weapon (character does casting motion).
    COMBAT_ANIMATIONS = {
        'slash', 'thrust', 'shoot', 'backslash', 'halfslash',
    }

    def get_supported_animations(
        self,
        selected_items: List[Dict[str, str]],
    ) -> Dict:
        """
        Determine animation support for a character's equipment.

        An animation is "supported" if all critical items (body, clothing, legs)
        have it — minor accessories and weapons missing an animation won't
        make it N/A since the character still looks clothed.

        Returns:
            {
                "supported": ["walk", "slash", ...],
                "na": ["climb", ...],
                "na_reasons": {"climb": ["torso_clothes_robe"]},
                "weapon_missing": {"shoot": ["weapon_sword_saber"]}
            }
        """
        item_names = [s['item'] for s in selected_items]
        if not item_names:
            return {"supported": [], "na": [], "na_reasons": {}, "weapon_missing": {}}

        # Get all items with their animations and type
        items = (
            self.session.query(Item)
            .options(joinedload(Item.animations))
            .filter(Item.file_name.in_(item_names))
            .all()
        )

        if not items:
            return {"supported": [], "na": [], "na_reasons": {}, "weapon_missing": {}}

        # Build per-item animation sets, separated by criticality
        critical_items = {}   # file_name -> anim set (body/clothes/legs/head)
        weapon_items = {}     # file_name -> anim set (weapons/shields)
        for item in items:
            anim_set = {a.name for a in item.animations}
            if item.type_name in self.CRITICAL_TYPES:
                critical_items[item.file_name] = anim_set
            elif item.type_name in self.WEAPON_TYPES:
                weapon_items[item.file_name] = anim_set

        # All standard animation names
        all_anims = {a[0] for a in ANIMATIONS}

        # Step 1: Intersect critical (clothing/body) items
        if critical_items:
            clothing_supported = set(all_anims)
            for anim_set in critical_items.values():
                clothing_supported &= anim_set
        else:
            clothing_supported = set(all_anims)

        # Step 2: For combat animations, also require weapons to support them
        supported = set()
        for anim_name in clothing_supported:
            if anim_name in self.COMBAT_ANIMATIONS and weapon_items:
                # Combat anim — weapon must also have it
                all_weapons_have = all(
                    anim_name in anim_set for anim_set in weapon_items.values()
                )
                if all_weapons_have:
                    supported.add(anim_name)
                # else: falls into na (weapon blocks this combat anim)
            else:
                # Non-combat anim — weapon doesn't matter
                supported.add(anim_name)

        na = all_anims - supported
        na_reasons = {}
        for anim_name in na:
            blockers = []
            # Check clothing blockers
            for fn, anim_set in critical_items.items():
                if anim_name not in anim_set:
                    blockers.append(fn)
            # Check weapon blockers (for combat anims)
            if anim_name in self.COMBAT_ANIMATIONS:
                for fn, anim_set in weapon_items.items():
                    if anim_name not in anim_set:
                        blockers.append(fn)
            if blockers:
                na_reasons[anim_name] = blockers

        # Weapon missing for non-combat animations: informational only (orange)
        weapon_missing = {}
        for anim_name in supported:
            missing_weapons = [
                fn for fn, anim_set in weapon_items.items()
                if anim_name not in anim_set
            ]
            if missing_weapons:
                weapon_missing[anim_name] = missing_weapons

        return {
            "supported": sorted(supported),
            "na": sorted(na),
            "na_reasons": na_reasons,
            "weapon_missing": weapon_missing,
        }

    # ------------------------------------------------------------------
    # Available options
    # ------------------------------------------------------------------

    def get_available_options(
        self,
        body_type: str,
        current_selections: List[Dict[str, str]] = None,
    ) -> Dict[str, List[Dict[str, any]]]:
        """Get all available options based on body type and current selections."""
        current_selections = current_selections or []
        current_tags = self._get_current_tags(current_selections)

        items = (
            self.session.query(Item)
            .options(
                joinedload(Item.layers).joinedload(ItemLayer.body_types),
                joinedload(Item.variants),
                joinedload(Item.tags),
                joinedload(Item.required_tags),
                joinedload(Item.excluded_tags),
            )
            .all()
        )

        available: Dict[str, list] = {}
        for item in items:
            if not self._is_item_compatible(item, body_type, current_tags):
                continue
            item_type = item.type_name
            if item_type not in available:
                available[item_type] = []
            available[item_type].append({
                'name': item.name,
                'file_name': item.file_name,
                'variants': [v.name for v in item.variants] if item.variants else [],
                'tags': [t.name for t in item.tags],
            })

        return available

    def _get_current_tags(self, selections: List[Dict[str, str]]) -> set:
        """Get all tags from current selections."""
        tags = set()
        item_names = [s['item'] for s in selections]
        if not item_names:
            return tags
        items = (
            self.session.query(Item)
            .options(joinedload(Item.tags))
            .filter(Item.file_name.in_(item_names))
            .all()
        )
        for item in items:
            tags.update(t.name for t in item.tags)
        return tags

    def _is_item_compatible(
        self,
        item: Item,
        body_type: str,
        current_tags: set,
    ) -> bool:
        """Check if an item is compatible with current selections."""
        has_body_type = item.fit_all_body_types or any(
            bt.body_type == body_type
            for layer in item.layers
            for bt in layer.body_types
        )
        if not has_body_type:
            return False

        for required_tag in item.required_tags:
            if required_tag.name not in current_tags:
                return False

        for excluded_tag in item.excluded_tags:
            if excluded_tag.name in current_tags:
                return False

        return True

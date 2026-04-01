"""
Filesystem scanner that checks which animation sprite files actually exist
for each item definition. Results are stored in PostgreSQL item_animations table
during ingestion — no scanning happens at runtime.
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
import logging

logger = logging.getLogger(__name__)

SPRITE_BASE_PATH = "/generator/spritesheets"
if not os.path.exists(SPRITE_BASE_PATH):
    SPRITE_BASE_PATH = "../Universal-LPC-Spritesheet-Character-Generator/spritesheets"

# Animation names as they appear on disk (directory names)
# These match sprite_generator.py's ANIMATIONS list
DISK_ANIMATIONS = [
    'spellcast', 'thrust', 'walk', 'slash', 'shoot',
    'hurt', 'climb', 'idle', 'jump', 'sit',
    'emote', 'run', 'combat_idle', 'backslash', 'halfslash',
]

BODY_TYPES = ['male', 'female', 'teen', 'child', 'muscular', 'pregnant', 'skeleton', 'zombie']


class AnimationScanner:
    """Scans the spritesheets filesystem to determine which animations
    actually have sprite files for each item definition."""

    def __init__(self, sprite_base_path: str = None, sheet_definitions_path: str = None,
                 custom_to_standard: Dict[str, str] = None):
        self.sprite_base_path = sprite_base_path or SPRITE_BASE_PATH
        self.sheet_definitions_path = sheet_definitions_path
        self.custom_to_standard = custom_to_standard or {}
        self._path_cache: Dict[str, bool] = {}

    def _path_exists(self, path: str) -> bool:
        """Cached os.path.exists check."""
        if path not in self._path_cache:
            self._path_cache[path] = os.path.exists(path)
        return self._path_cache[path]

    def scan_item(self, json_data: dict, file_name: str) -> Dict[str, bool]:
        """
        Scan a single item definition and return which animations are supported.

        Returns:
            Dict mapping animation name (disk names) to True/False availability.
            An animation is "supported" if ALL standard layers have the sprite file,
            OR if custom_animation layers provide that animation.
        """
        # Separate standard layers from custom_animation layers
        standard_layers = []
        custom_layers = []  # list of (custom_animation_name, body_type_paths)
        layer_count = 1
        while f'layer_{layer_count}' in json_data:
            layer_data = json_data[f'layer_{layer_count}']

            body_type_paths = {}
            for bt in BODY_TYPES:
                if bt in layer_data and layer_data[bt]:
                    body_type_paths[bt] = layer_data[bt]

            if 'custom_animation' in layer_data:
                if body_type_paths:
                    custom_layers.append((layer_data['custom_animation'], body_type_paths))
            else:
                if body_type_paths:
                    standard_layers.append(body_type_paths)

            layer_count += 1

        # Get variants and replace_in_path for path resolution
        variants = self._get_variant_names(json_data)
        replace_in_path = json_data.get('replace_in_path')

        # Determine which standard animations are provided by custom layers
        # (e.g., slash_oversize -> slash)
        custom_provides: Set[str] = set()
        for custom_name, custom_paths in custom_layers:
            mapped = self.custom_to_standard.get(custom_name)
            if mapped:
                # Verify the custom layer actually has files
                for body_type, sprite_path in custom_paths.items():
                    resolved = self._resolve_path(sprite_path, replace_in_path)
                    if self._check_animation_file(resolved, variants):
                        custom_provides.add(mapped)
                        break

        # For each animation, check standard layers OR custom layer coverage
        result = {}
        for anim_name in DISK_ANIMATIONS:
            if anim_name in custom_provides:
                # Custom layers provide this animation (oversized attack sprites, etc.)
                result[anim_name] = True
            elif standard_layers:
                supported = self._check_animation_across_layers(
                    standard_layers, anim_name, variants, replace_in_path
                )
                result[anim_name] = supported
            else:
                result[anim_name] = False

        return result

    def _check_animation_across_layers(
        self,
        standard_layers: List[Dict[str, str]],
        animation: str,
        variants: List[str],
        replace_in_path: Optional[dict],
    ) -> bool:
        """
        Check if an animation is supported by ANY standard layer.
        The sprite generator silently skips missing files per-layer,
        so an animation is visually present as long as at least one
        layer has the sprite (e.g., main weapon layer has hurt even
        if the behind-layer doesn't).
        """
        for layer_paths in standard_layers:
            for body_type, sprite_path in layer_paths.items():
                resolved_path = self._resolve_path(sprite_path, replace_in_path)
                if self._check_animation_file_by_name(resolved_path, animation, variants):
                    return True
        return False

    def _check_animation_file_by_name(
        self,
        sprite_path: str,
        animation: str,
        variants: List[str],
    ) -> bool:
        """Check if a specific animation sprite file exists for a given path."""
        sprite_path = sprite_path.rstrip('/')
        base = os.path.join(self.sprite_base_path, sprite_path)

        if variants:
            # Check with first variant as representative
            variant = variants[0]
            full_path = f"{base}/{animation}/{variant}.png"
            if self._path_exists(full_path):
                return True
            # Check the directory exists (any variant file present)
            anim_dir = f"{base}/{animation}"
            if self._path_exists(anim_dir) and os.path.isdir(anim_dir):
                return True
            # Fallback: some layers don't use variants even when the item has them
            # (e.g., universal_behind layers use direct .png files)
            fallback_path = f"{base}/{animation}.png"
            if self._path_exists(fallback_path):
                return True
        else:
            # No variants — check for direct animation file
            full_path = f"{base}/{animation}.png"
            if self._path_exists(full_path):
                return True

        return False

    def _check_animation_file(
        self,
        sprite_path: str,
        variants: List[str],
    ) -> bool:
        """Check if a custom animation layer path has any sprite files.
        Custom layers have their own directory structure — just check if
        any .png exists under the path (with or without variants)."""
        sprite_path = sprite_path.rstrip('/')
        base = os.path.join(self.sprite_base_path, sprite_path)

        if variants:
            # Check for variant file directly in the directory
            variant = variants[0]
            if self._path_exists(f"{base}/{variant}.png"):
                return True
        # Check if any png exists directly
        if self._path_exists(base) and os.path.isdir(base):
            try:
                for entry in os.listdir(base):
                    if entry.endswith('.png'):
                        return True
            except OSError:
                pass
        # Check if it's a single file
        if self._path_exists(f"{base}.png"):
            return True
        return False

    def _resolve_path(self, sprite_path: str, replace_in_path: Optional[dict]) -> str:
        """Resolve template variables in sprite path using first available value."""
        if not replace_in_path:
            return sprite_path

        for key, value_map in replace_in_path.items():
            placeholder = f"${{{key}}}"
            if placeholder in sprite_path:
                if isinstance(value_map, dict):
                    # Use the first non-None value
                    replacement = next(
                        (v for v in value_map.values() if v and v != 'none'),
                        ''
                    )
                else:
                    replacement = str(value_map) if value_map else ''
                sprite_path = sprite_path.replace(placeholder, replacement)

        return sprite_path

    def _get_variant_names(self, json_data: dict) -> List[str]:
        """Extract flat variant name list from JSON data."""
        variants = json_data.get('variants', [])
        names = []
        for v in variants:
            if isinstance(v, str):
                names.append(v)
            elif isinstance(v, dict) and 'name' in v:
                names.append(v['name'])
        return names

    def scan_all_definitions(self) -> Dict[str, Dict[str, bool]]:
        """
        Scan all JSON definitions and return animation availability for each.

        Returns:
            Dict mapping file_name (stem) to animation availability dict.
        """
        if not self.sheet_definitions_path:
            raise ValueError("sheet_definitions_path is required for scan_all_definitions")

        results = {}
        json_files = sorted(Path(self.sheet_definitions_path).glob("*.json"))
        print(f"Scanning {len(json_files)} item definitions for animation availability...")

        for idx, json_file in enumerate(json_files):
            if idx % 100 == 0 and idx > 0:
                print(f"  Scanned {idx}/{len(json_files)}...")
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                results[json_file.stem] = self.scan_item(data, json_file.stem)
            except Exception as e:
                logger.warning(f"Error scanning {json_file.name}: {e}")
                results[json_file.stem] = {anim: False for anim in DISK_ANIMATIONS}

        supported_counts = {}
        for file_name, anims in results.items():
            count = sum(1 for v in anims.values() if v)
            supported_counts[count] = supported_counts.get(count, 0) + 1

        print(f"Scan complete. Animation support distribution:")
        for count in sorted(supported_counts.keys()):
            print(f"  {count}/15 animations: {supported_counts[count]} items")

        return results

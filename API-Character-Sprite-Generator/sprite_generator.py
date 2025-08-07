"""
Sprite generation service using direct image composition with Pillow.
Replaces the Puppeteer-based approach with database-driven sprite generation.
"""

import os
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from PIL import Image
import io
from sqlalchemy.orm import Session
from models import Item, ItemLayer, ItemLayerBodyType, ItemVariant
import logging

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

SPRITE_BASE_PATH = "/generator/spritesheets"
if not os.path.exists(SPRITE_BASE_PATH):
    SPRITE_BASE_PATH = "../Universal-LPC-Spritesheet-Character-Generator/spritesheets"
    
logger.info(f"Using sprite base path: {SPRITE_BASE_PATH}")

SPRITE_WIDTH = 64
SPRITE_HEIGHT = 64
SHEET_COLUMNS = 13
SHEET_ROWS = 53

class SpriteGenerator:
    """Generates character spritesheets by compositing layers from the database."""
    
    def __init__(self, session: Session):
        self.session = session
        self.sprite_cache = {}
        
    def generate_spritesheet(
        self, 
        body_type: str,
        selected_items: List[Dict[str, str]]
    ) -> bytes:
        """
        Generate a complete spritesheet for a character.
        
        Args:
            body_type: The body type (male, female, child, etc.)
            selected_items: List of dicts with 'type', 'item', and optional 'variant'
                           e.g., [{'type': 'body', 'item': 'body', 'variant': 'light'},
                                  {'type': 'hair', 'item': 'hair_long', 'variant': 'blonde'}]
        
        Returns:
            PNG image bytes of the complete spritesheet
        """
        logger.info(f"Generating spritesheet for body_type: {body_type}")
        logger.info(f"Selected items: {selected_items}")
        
        layers_to_draw = self._get_layers_to_draw(body_type, selected_items)
        logger.info(f"Found {len(layers_to_draw)} layers to draw")
        
        layers_to_draw.sort(key=lambda x: x['z_pos'] if x['z_pos'] is not None else 0)
        
        # Create the full spritesheet canvas
        spritesheet = Image.new('RGBA', (SPRITE_WIDTH * SHEET_COLUMNS, SPRITE_HEIGHT * SHEET_ROWS), (0, 0, 0, 0))
        
        # Combine all animations for each layer
        for layer_info in layers_to_draw:
            layer_sheet = self._create_full_sheet_for_layer(layer_info, body_type, selected_items)
            if layer_sheet:
                spritesheet = Image.alpha_composite(spritesheet, layer_sheet)
                    
        logger.info(f"Successfully composited spritesheet")
        
        output = io.BytesIO()
        spritesheet.save(output, format='PNG')
        return output.getvalue()
        
    def _create_full_sheet_for_layer(self, layer_info: Dict, body_type: str, selected_items: List[Dict[str, str]]) -> Optional[Image.Image]:
        """Create a full spritesheet for a single layer by combining all its animations."""
        # Animation list with their row positions in the final sheet
        animations = [
            ('spellcast', 0),
            ('thrust', 4),
            ('walk', 8),
            ('slash', 12),
            ('shoot', 16),
            ('hurt', 20),
            ('climb', 21),
            ('idle', 22),
            ('jump', 26),
            ('sit', 30),
            ('emote', 34),
            ('run', 38),
            ('combat_idle', 42),
            ('backslash', 46),
            ('halfslash', 50)
        ]
        
        # Create a blank canvas for this layer
        layer_sheet = Image.new('RGBA', (SPRITE_WIDTH * SHEET_COLUMNS, SPRITE_HEIGHT * SHEET_ROWS), (0, 0, 0, 0))
        animations_found = 0
        
        for animation_name, start_row in animations:
            sprite_path = self._resolve_animation_path(layer_info, body_type, animation_name)
            
            if os.path.exists(sprite_path):
                try:
                    anim_image = Image.open(sprite_path).convert('RGBA')
                    
                    # Apply body color matching if needed
                    if layer_info.get('match_body_color'):
                        body_color = self._get_body_color(selected_items)
                        if body_color:
                            anim_image = self._apply_color_mask(anim_image, body_color)
                    
                    # Calculate where to paste this animation
                    y_position = start_row * SPRITE_HEIGHT
                    
                    # Paste the animation at the correct position
                    layer_sheet.paste(anim_image, (0, y_position), anim_image)
                    animations_found += 1
                    logger.debug(f"Added animation {animation_name} at row {start_row}")
                    
                except Exception as e:
                    logger.debug(f"Could not load {animation_name}: {e}")
            else:
                logger.debug(f"Animation not found: {sprite_path}")
                
        if animations_found > 0:
            logger.info(f"Created layer with {animations_found} animations")
            return layer_sheet
        else:
            return None
            
    def _resolve_animation_path(self, layer_info: Dict, body_type: str, animation: str) -> str:
        """Resolve the path for a specific animation of a layer."""
        sprite_path = layer_info['sprite_path']
        variant = layer_info.get('variant')
        item = layer_info['item']
        
        # Handle template replacements
        if item.replace_in_path:
            for key, value in item.replace_in_path.items():
                if f"${{{key}}}" in sprite_path:
                    if isinstance(value, dict):
                        replacement = value.get(variant) if variant else value.get('default', '')
                    else:
                        replacement = value if value else ''
                    
                    # Make sure replacement is a string
                    if replacement is None:
                        replacement = ''
                    
                    sprite_path = sprite_path.replace(f"${{{key}}}", str(replacement))
        
        # Remove trailing slash if present
        if sprite_path.endswith('/'):
            sprite_path = sprite_path[:-1]
                    
        # Build the path with animation subdirectory
        if variant:
            sprite_path = f"{sprite_path}/{animation}/{variant}.png"
        else:
            # No variant, just use the animation sheet
            sprite_path = f"{sprite_path}/{animation}.png"
            
        full_path = os.path.join(SPRITE_BASE_PATH, sprite_path)
        
        return full_path
        
    def _get_layers_to_draw(
        self, 
        body_type: str, 
        selected_items: List[Dict[str, str]]
    ) -> List[Dict]:
        """Get all layers that need to be drawn for the selected items."""
        layers = []
        
        for selection in selected_items:
            logger.debug(f"Processing selection: {selection}")
            
            item = self.session.query(Item).filter_by(
                file_name=selection['item']
            ).first()
            
            if not item:
                logger.warning(f"Item not found in database: {selection['item']}")
                continue
                
            logger.debug(f"Found item: {item.name} with {len(item.layers)} layers")
            
            for layer in item.layers:
                body_type_layer = next(
                    (bt for bt in layer.body_types if bt.body_type == body_type),
                    None
                )
                
                if body_type_layer:
                    layer_info = {
                        'item': item,
                        'layer': layer,
                        'body_type_layer': body_type_layer,
                        'z_pos': layer.z_pos,
                        'variant': selection.get('variant'),
                        'match_body_color': item.match_body_color,
                        'sprite_path': body_type_layer.sprite_path
                    }
                    layers.append(layer_info)
                    logger.debug(f"Added layer: {body_type_layer.sprite_path} at z_pos {layer.z_pos}")
                else:
                    logger.debug(f"No {body_type} body type for this layer")
                    
        return layers
        
        
    def _get_body_color(self, selected_items: List[Dict[str, str]]) -> Optional[str]:
        """Get the body color from the selections."""
        body_selection = next(
            (s for s in selected_items if s['type'] == 'body'),
            None
        )
        return body_selection.get('variant') if body_selection else None
        
    def _apply_color_mask(self, image: Image.Image, color: str) -> Image.Image:
        """Apply a color mask to match body color (for items like eyes)."""
        return image
        
    def get_available_options(
        self,
        body_type: str,
        current_selections: List[Dict[str, str]] = None
    ) -> Dict[str, List[Dict[str, any]]]:
        """
        Get all available options based on body type and current selections.
        
        Returns:
            Dict mapping item types to lists of available items with their variants
        """
        current_selections = current_selections or []
        current_tags = self._get_current_tags(current_selections)
        
        items = self.session.query(Item).all()
        available = {}
        
        for item in items:
            if not self._is_item_compatible(item, body_type, current_tags):
                continue
                
            item_type = item.type_name
            if item_type not in available:
                available[item_type] = []
                
            item_data = {
                'name': item.name,
                'file_name': item.file_name,
                'variants': [v.name for v in item.variants] if item.variants else [],
                'tags': [t.name for t in item.tags]
            }
            available[item_type].append(item_data)
            
        return available
        
    def _get_current_tags(self, selections: List[Dict[str, str]]) -> set:
        """Get all tags from current selections."""
        tags = set()
        
        for selection in selections:
            item = self.session.query(Item).filter_by(
                file_name=selection['item']
            ).first()
            
            if item:
                tags.update(t.name for t in item.tags)
                
        return tags
        
    def _is_item_compatible(
        self, 
        item: Item, 
        body_type: str, 
        current_tags: set
    ) -> bool:
        """Check if an item is compatible with current selections."""
        has_body_type = False
        for layer in item.layers:
            if any(bt.body_type == body_type for bt in layer.body_types):
                has_body_type = True
                break
                
        if not has_body_type and not item.fit_all_body_types:
            return False
            
        for required_tag in item.required_tags:
            if required_tag.name not in current_tags:
                return False
                
        for excluded_tag in item.excluded_tags:
            if excluded_tag.name in current_tags:
                return False
                
        return True
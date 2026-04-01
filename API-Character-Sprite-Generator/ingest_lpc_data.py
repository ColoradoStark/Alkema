#!/usr/bin/env python3
"""
Script to ingest LPC sheet definitions from JSON files into PostgreSQL database.
Run this after the database is initialized to populate all the LPC character data.
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import SQLAlchemyError
from models import (
    init_database, create_session,
    Item, ItemLayer, ItemLayerBodyType, ItemVariant, ItemCredit,
    Tag, Animation, BodyType, item_animations,
    CustomAnimation, CustomAnimationFrame,
)
from animation_scanner import AnimationScanner, DISK_ANIMATIONS

CUSTOM_ANIMATIONS_PATH = "/generator/sources/custom-animations.js"
if not os.path.exists(CUSTOM_ANIMATIONS_PATH):
    CUSTOM_ANIMATIONS_PATH = "../Universal-LPC-Spritesheet-Character-Generator/sources/custom-animations.js"


def parse_custom_animations_js(file_path: str) -> Dict[str, Dict]:
    """
    Parse custom-animations.js and extract custom animation definitions.

    Returns dict like:
    {
        'slash_oversize': {
            'frame_size': 192,
            'frames': [
                [('slash', 'n', 0), ('slash', 'n', 1), ...],  # direction 0 (N)
                [('slash', 'w', 0), ('slash', 'w', 1), ...],  # direction 1 (W)
                ...
            ]
        },
        ...
    }
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract the customAnimations object block
    match = re.search(r'const\s+customAnimations\s*=\s*\{', content)
    if not match:
        raise ValueError("Could not find customAnimations in JS file")

    # Find the matching closing brace by counting braces
    brace_count = 0
    obj_start = None
    for i in range(match.end() - 1, len(content)):
        if content[i] == '{':
            brace_count += 1
            if obj_start is None:
                obj_start = i
        elif content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                obj_end = i + 1
                break

    obj_text = content[obj_start:obj_end]

    # Parse individual animation entries using regex
    results = {}
    anim_pattern = re.compile(
        r'(\w+)\s*:\s*\{[^}]*?frameSize\s*:\s*(\d+)\s*,'
        r'[^}]*?frames\s*:\s*\[(.*?)\]\s*\}',
        re.DOTALL
    )

    for m in anim_pattern.finditer(obj_text):
        name = m.group(1)
        frame_size = int(m.group(2))
        frames_text = m.group(3)

        # Parse each direction row: [...], [...], ...
        directions = []
        row_pattern = re.compile(r'\[(.*?)\]', re.DOTALL)
        for row_match in row_pattern.finditer(frames_text):
            row_text = row_match.group(1)
            frame_refs = re.findall(r'"([^"]+)"', row_text)
            parsed_frames = []
            for ref in frame_refs:
                anim_dir, frame_idx = ref.rsplit(',', 1)
                anim_name, direction = anim_dir.rsplit('-', 1)
                parsed_frames.append((anim_name, direction, int(frame_idx)))
            if parsed_frames:
                directions.append(parsed_frames)

        if directions:
            results[name] = {
                'frame_size': frame_size,
                'frames': directions,
            }

    return results


SHEET_DEFINITIONS_PATH = "/generator/sheet_definitions"
if not os.path.exists(SHEET_DEFINITIONS_PATH):
    SHEET_DEFINITIONS_PATH = "../Universal-LPC-Spritesheet-Character-Generator/sheet_definitions"

BODY_TYPES = ['male', 'female', 'teen', 'child', 'muscular', 'pregnant', 'skeleton', 'zombie']

ANIMATIONS = {
    'spellcast': {'row': 0, 'num': 4, 'cycle': '7'},
    'thrust': {'row': 4, 'num': 4, 'cycle': '8'},
    'walk': {'row': 8, 'num': 4, 'cycle': '9'},
    'slash': {'row': 12, 'num': 4, 'cycle': '6'},
    'shoot': {'row': 16, 'num': 4, 'cycle': '13'},
    'hurt': {'row': 20, 'num': 1, 'cycle': '6'},
    'climb': {'row': 21, 'num': 1, 'cycle': '6'},
    'idle': {'row': 22, 'num': 4, 'custom_cycle': '0-0-1'},
    'jump': {'row': 26, 'num': 4, 'custom_cycle': '0-1-2-3-4-1'},
    'sit': {'row': 30, 'num': 4, 'custom_cycle': '0-0-0-0-0-1-1-1-1-1-2-2-2-2-2'},
    'emote': {'row': 34, 'num': 4, 'custom_cycle': '0-0-0-0-0-1-1-1-1-1-2-2-2-2-2'},
    'run': {'row': 38, 'num': 4, 'cycle': '8'},
    'watering': {'row': 4, 'num': 4, 'cycle': '4', 'custom_cycle': '0-1-4-4-4-4-5'},
    'combat': {'row': 42, 'num': 4, 'custom_cycle': '0-0-1'},
    '1h_slash': {'row': 46, 'num': 4, 'custom_cycle': '0-1-2-3-4-5-6'},
    '1h_backslash': {'row': 46, 'num': 4, 'custom_cycle': '0-1-2-3-4-5-7-8-9-10-11-12'},
    '1h_halfslash': {'row': 50, 'num': 4, 'cycle': '6'},
}

class LPCDataIngester:
    def __init__(self, session: Session):
        self.session = session
        self.tags_cache: Dict[str, Tag] = {}
        self.animations_cache: Dict[str, Animation] = {}
        self.body_types_cache: Dict[str, BodyType] = {}
        self.items_processed = 0
        self.errors = []
        
    def ingest_all(self):
        """Main ingestion process."""
        print("Starting LPC data ingestion...")

        try:
            self._init_static_data()
            self._ingest_custom_animations()
            self._process_json_files()
            self._scan_and_update_animations()

            print(f"\nIngestion complete!")
            print(f"Items processed: {self.items_processed}")
            if self.errors:
                print(f"Errors encountered: {len(self.errors)}")
                for error in self.errors[:10]:
                    print(f"  - {error}")

        except Exception as e:
            print(f"Fatal error during ingestion: {e}")
            self.session.rollback()
            raise
            
    def _init_static_data(self):
        """Initialize animations and body types."""
        print("Initializing static data...")
        
        # Load existing animations
        existing_anims = self.session.query(Animation).all()
        for anim in existing_anims:
            self.animations_cache[anim.name] = anim
        
        # Add missing animations
        for name, data in ANIMATIONS.items():
            if name not in self.animations_cache:
                anim = Animation(
                    name=name,
                    row=data.get('row'),
                    num_directions=data.get('num'),
                    cycle=data.get('cycle'),
                    custom_cycle=data.get('custom_cycle')
                )
                self.session.add(anim)
                self.animations_cache[name] = anim
        
        # Load existing body types        
        existing_body_types = self.session.query(BodyType).all()
        for bt in existing_body_types:
            self.body_types_cache[bt.name] = bt
                
        # Add missing body types
        for body_type in BODY_TYPES:
            if body_type not in self.body_types_cache:
                bt = BodyType(
                    name=body_type,
                    display_name=body_type.capitalize(),
                    tags=[body_type]
                )
                self.session.add(bt)
                self.body_types_cache[body_type] = bt
                
        self.session.commit()
        print(f"  Animations in cache: {len(self.animations_cache)}")
        print(f"  Body types in cache: {len(self.body_types_cache)}")

    def _ingest_custom_animations(self):
        """Ingest custom animation definitions from custom-animations.js."""
        existing = self.session.query(CustomAnimation).count()
        if existing > 0:
            print(f"  Custom animations already ingested ({existing} definitions). Skipping.")
            return

        if not os.path.exists(CUSTOM_ANIMATIONS_PATH):
            print(f"  WARNING: custom-animations.js not found at {CUSTOM_ANIMATIONS_PATH}")
            return

        print("  Ingesting custom animation definitions...")
        definitions = parse_custom_animations_js(CUSTOM_ANIMATIONS_PATH)

        for name, defn in definitions.items():
            custom_anim = CustomAnimation(
                name=name,
                frame_size=defn['frame_size'],
                num_directions=len(defn['frames']),
                num_frames=len(defn['frames'][0]) if defn['frames'] else 0,
            )
            self.session.add(custom_anim)
            self.session.flush()

            for dir_idx, direction_frames in enumerate(defn['frames']):
                for frame_idx, (src_anim, src_dir, src_frame) in enumerate(direction_frames):
                    frame = CustomAnimationFrame(
                        custom_animation_id=custom_anim.id,
                        direction_index=dir_idx,
                        frame_index=frame_idx,
                        source_animation=src_anim,
                        source_direction=src_dir,
                        source_frame=src_frame,
                    )
                    self.session.add(frame)

        self.session.commit()
        print(f"  Ingested {len(definitions)} custom animation definitions.")

    def _get_or_create_tag(self, tag_name: str) -> Tag:
        """Get existing tag or create new one."""
        if tag_name not in self.tags_cache:
            tag = self.session.query(Tag).filter_by(name=tag_name).first()
            if not tag:
                tag = Tag(name=tag_name)
                self.session.add(tag)
            self.tags_cache[tag_name] = tag
        return self.tags_cache[tag_name]
        
    def _process_json_files(self):
        """Process all JSON files in sheet_definitions directory."""
        json_files = list(Path(SHEET_DEFINITIONS_PATH).glob("*.json"))
        print(f"Found {len(json_files)} JSON files to process")
        
        for idx, json_file in enumerate(json_files):
            if idx % 50 == 0:
                print(f"  Processing {idx}/{len(json_files)}...")
                self.session.commit()
                
            try:
                self._process_single_file(json_file)
            except Exception as e:
                error_msg = f"Error processing {json_file.name}: {e}"
                self.errors.append(error_msg)
                print(f"    ERROR: {error_msg}")
                self.session.rollback()
                
        self.session.commit()
        
    def _process_single_file(self, json_file: Path):
        """Process a single JSON file."""
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        item = Item(
            file_name=json_file.stem,
            name=data.get('name', json_file.stem),
            type_name=data.get('type_name', self._infer_type_from_filename(json_file.stem)),
            match_body_color=data.get('match_body_color', False),
            fit_all_body_types=data.get('fit_all_body_types', False),
            sheet=data.get('sheet'),
            template_data=data.get('template') if 'template' in data else None,
            replace_in_path=data.get('replace_in_path') if 'replace_in_path' in data else None
        )
        
        self._process_layers(item, data)
        self._process_variants(item, data)
        self._process_tags(item, data)
        self._process_animations(item, data)
        self._process_credits(item, data)
        
        self.session.add(item)
        self.items_processed += 1
        
    def _process_layers(self, item: Item, data: Dict):
        """Process item layers."""
        layer_count = 1
        while f'layer_{layer_count}' in data:
            layer_data = data[f'layer_{layer_count}']
            
            layer = ItemLayer(
                item=item,
                layer_number=layer_count,
                z_pos=layer_data.get('zPos'),
                custom_animation=layer_data.get('custom_animation')
            )
            
            for body_type in BODY_TYPES:
                if body_type in layer_data:
                    sprite_path = layer_data[body_type]
                    if sprite_path:
                        layer_body = ItemLayerBodyType(
                            layer=layer,
                            body_type=body_type,
                            sprite_path=sprite_path
                        )
                        layer.body_types.append(layer_body)
                        
            item.layers.append(layer)
            layer_count += 1
            
    def _process_variants(self, item: Item, data: Dict):
        """Process item variants."""
        variants = data.get('variants', [])
        
        if isinstance(variants, list):
            for variant in variants:
                if isinstance(variant, str):
                    item_variant = ItemVariant(
                        item=item,
                        name=variant,
                        value=variant
                    )
                elif isinstance(variant, dict):
                    name = variant.get('name', '')
                    item_variant = ItemVariant(
                        item=item,
                        name=name,
                        value=variant.get('value', name),
                        rgb_values=variant.get('rgb')
                    )
                    if 'variants' in variant:
                        self._process_nested_variants(item, variant['variants'], f"{name}_")
                else:
                    continue
                    
                item.variants.append(item_variant)
                
    def _process_nested_variants(self, item: Item, variants: List, prefix: str = ''):
        """Process nested variants recursively."""
        for variant in variants:
            if isinstance(variant, str):
                item_variant = ItemVariant(
                    item=item,
                    name=f"{prefix}{variant}",
                    value=variant
                )
                item.variants.append(item_variant)
            elif isinstance(variant, dict) and 'name' in variant:
                name = f"{prefix}{variant['name']}"
                item_variant = ItemVariant(
                    item=item,
                    name=name,
                    value=variant.get('value', variant['name']),
                    rgb_values=variant.get('rgb')
                )
                item.variants.append(item_variant)
                
    def _process_tags(self, item: Item, data: Dict):
        """Process item tags and dependencies."""
        tags = data.get('tags', [])
        for tag_name in tags:
            tag = self._get_or_create_tag(tag_name)
            item.tags.append(tag)
            
        required_tags = data.get('required_tags', [])
        for tag_name in required_tags:
            tag = self._get_or_create_tag(tag_name)
            item.required_tags.append(tag)
            
        excluded_tags = data.get('excluded_tags', [])
        for tag_name in excluded_tags:
            tag = self._get_or_create_tag(tag_name)
            item.excluded_tags.append(tag)
            
    def _process_animations(self, item: Item, data: Dict):
        """Process supported animations - placeholder during initial ingestion.
        Actual animation data is populated by the filesystem scanner in _scan_and_update_animations."""
        # Store declared animations from JSON for reference, but don't trust them.
        # The scanner will override with verified data after all items are ingested.
        animations = data.get('animations', [])
        for anim_name in animations:
            if anim_name in self.animations_cache:
                item.animations.append(self.animations_cache[anim_name])
                
    def _scan_and_update_animations(self):
        """Run filesystem scanner and update item_animations with verified data."""
        print("\nRunning filesystem animation scanner...")

        # Build custom_to_standard mapping from DB
        custom_to_standard = {}
        custom_anims = self.session.query(CustomAnimation).options(
            joinedload(CustomAnimation.frames)
        ).all()
        for ca in custom_anims:
            if ca.frames:
                custom_to_standard[ca.name] = ca.frames[0].source_animation
        if custom_to_standard:
            print(f"  Custom-to-standard mappings: {custom_to_standard}")

        scanner = AnimationScanner(
            sheet_definitions_path=SHEET_DEFINITIONS_PATH,
            custom_to_standard=custom_to_standard,
        )
        scan_results = scanner.scan_all_definitions()

        # Ensure all disk animation names exist in the animations table
        for anim_name in DISK_ANIMATIONS:
            if anim_name not in self.animations_cache:
                anim = Animation(name=anim_name)
                self.session.add(anim)
                self.animations_cache[anim_name] = anim
        self.session.flush()

        # Build animation name -> id lookup
        anim_id_map = {
            name: anim.id for name, anim in self.animations_cache.items()
        }

        # Get all items from DB
        all_items = self.session.query(Item).all()
        item_id_map = {item.file_name: item.id for item in all_items}

        # Clear existing item_animations and repopulate with scanner results
        from sqlalchemy import text
        self.session.execute(text("DELETE FROM item_animations"))

        insert_count = 0
        for file_name, anim_support in scan_results.items():
            item_id = item_id_map.get(file_name)
            if not item_id:
                continue
            for anim_name, supported in anim_support.items():
                if supported and anim_name in anim_id_map:
                    self.session.execute(
                        item_animations.insert().values(
                            item_id=item_id,
                            animation_id=anim_id_map[anim_name]
                        )
                    )
                    insert_count += 1

        self.session.commit()
        print(f"Animation scan complete. {insert_count} item-animation associations written to DB.")

    def _process_credits(self, item: Item, data: Dict):
        """Process item credits/attribution."""
        credits = data.get('credits', [])
        
        if isinstance(credits, list) and credits:
            if isinstance(credits[0], dict):
                for credit_data in credits:
                    credit = ItemCredit(
                        item=item,
                        body_type=credit_data.get('body_type'),
                        authors=credit_data.get('authors', []),
                        licenses=credit_data.get('licenses', []),
                        urls=credit_data.get('urls', [])
                    )
                    item.credits.append(credit)
            elif isinstance(credits[0], str):
                credit = ItemCredit(
                    item=item,
                    authors=credits,
                    licenses=['CC-BY-SA 3.0'],
                    urls=[]
                )
                item.credits.append(credit)
                
    def _infer_type_from_filename(self, filename: str) -> str:
        """Infer item type from filename."""
        parts = filename.split('_')
        if parts:
            return parts[0]
        return 'unknown'

def main():
    """Main entry point."""
    print("Initializing database...")
    
    try:
        # Initialize database tables
        init_database()
        print("Database tables created/verified")
    except Exception as e:
        print(f"Error initializing database: {e}")
        print("This might be normal if tables already exist")
    
    session = create_session()
    
    # Check if data already exists
    try:
        from sqlalchemy import text
        item_count = session.execute(text("SELECT COUNT(*) FROM items")).scalar()
        if item_count > 0:
            print(f"Database already contains {item_count} items. Skipping ingestion.")
            session.close()
            return
    except Exception as e:
        print(f"Could not check existing data: {e}")
        print("Proceeding with ingestion...")
    
    try:
        ingester = LPCDataIngester(session)
        ingester.ingest_all()
    except KeyboardInterrupt:
        print("\nIngestion interrupted by user")
        session.rollback()
    except Exception as e:
        print(f"Ingestion failed: {e}")
        session.rollback()
        sys.exit(1)
    finally:
        session.close()
        
    print("Data ingestion completed successfully!")

if __name__ == "__main__":
    main()
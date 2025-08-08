#!/usr/bin/env python3
"""
Endpoint to provide available LPC assets information.
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Any
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

# Path to sheet definitions
SHEET_DEFINITIONS_PATH = "/generator/sheet_definitions"
if not os.path.exists(SHEET_DEFINITIONS_PATH):
    SHEET_DEFINITIONS_PATH = "../Universal-LPC-Spritesheet-Character-Generator/sheet_definitions"

def get_available_assets():
    """Parse all JSON files and extract available assets."""
    assets = {
        'hair': [],
        'torso': [],
        'legs': [],
        'accessories': [],
        'weapons': []
    }
    
    try:
        json_files = list(Path(SHEET_DEFINITIONS_PATH).glob("*.json"))
        
        for json_file in json_files:
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            item_name = json_file.stem
            item_type = item_name.split('_')[0]
            
            # Extract relevant information
            item_info = {
                'file_name': item_name,
                'name': data.get('name', item_name),
                'type': data.get('type_name', item_type),
                'variants': data.get('variants', []),
                'fit_all_body_types': data.get('fit_all_body_types', False),
                'body_types': []
            }
            
            # Check which body types this item supports
            layer_1 = data.get('layer_1', {})
            for body_type in ['male', 'female', 'teen', 'child', 'muscular', 'pregnant']:
                if body_type in layer_1:
                    item_info['body_types'].append(body_type)
            
            # Special handling for female-only items
            if 'female' in item_info['body_types'] and 'male' not in item_info['body_types']:
                item_info['female_only'] = True
            
            # Categorize items
            if item_type == 'hair':
                assets['hair'].append(item_info)
            elif item_type in ['torso', 'shirt', 'vest', 'tunic', 'blouse', 'longsleeve']:
                assets['torso'].append(item_info)
            elif item_type in ['legs', 'pants', 'skirt']:
                assets['legs'].append(item_info)
            elif item_type in ['weapon', 'shield']:
                assets['weapons'].append(item_info)
            else:
                assets['accessories'].append(item_info)
                
    except Exception as e:
        print(f"Error reading assets: {e}")
        
    return assets

def get_safe_random_assets():
    """Get a curated list of assets that are known to work well."""
    return {
        'male': {
            'hair_styles': [
                {'name': 'plain', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'bedhead', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'buzzcut', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white']},
                {'name': 'messy1', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'spiked', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'parted', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']}
            ],
            'shirt_types': [
                {'name': 'vest', 'variants': ['brown', 'blue', 'green', 'red', 'black', 'white', 'purple', 'gray']}
            ],
            'skin_colors': ['light', 'amber', 'olive', 'brown', 'black'],
            'pants_colors': ['brown', 'black', 'blue', 'gray', 'tan']
        },
        'female': {
            'hair_styles': [
                {'name': 'plain', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'loose', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'ponytail', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'princess', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'pixie', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'long', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'bob', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']},
                {'name': 'shoulderl', 'variants': ['blonde', 'dark_brown', 'black', 'gray', 'white', 'red']}
            ],
            'shirt_types': [
                {'name': 'tunic', 'variants': ['brown', 'blue', 'green', 'red', 'black', 'white', 'purple', 'pink', 'teal']}
            ],
            'skin_colors': ['light', 'amber', 'olive', 'brown', 'black'],
            'pants_colors': ['brown', 'black', 'blue', 'gray', 'tan']
        }
    }

# Add this endpoint to your existing FastAPI app
async def available_assets_endpoint():
    """API endpoint to get available assets."""
    try:
        # For now, return the safe curated list
        # Later we can switch to the full parsed list once validated
        assets = get_safe_random_assets()
        return JSONResponse(content=assets)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
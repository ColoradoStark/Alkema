from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.responses import Response, JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import distinct, func
from models import (
    create_session, init_database,
    Item, ItemLayer, ItemLayerBodyType, ItemVariant, ItemCredit,
    Tag, Animation, BodyType,
    item_tags, item_required_tags, item_excluded_tags, item_animations,
)
from sprite_generator import SpriteGenerator
import os
import random

# MongoDB imports
from mongodb_models import MongoDBConnection
from game_endpoints import router as game_router


# ---------------------------------------------------------------------------
# Pydantic response / request models
# ---------------------------------------------------------------------------

# --- Shared sub-models ---

class VariantOut(BaseModel):
    name: str = Field(..., description="Variant identifier used in API calls (e.g. 'blonde', 'teal')")
    value: str = Field(..., description="Display value or path segment for this variant")
    rgb_values: Optional[List[int]] = Field(None, description="RGB colour values [r, g, b] when the variant is a colour")

    class Config:
        from_attributes = True


class LayerBodyTypeOut(BaseModel):
    body_type: str = Field(..., description="Body type name (male, female, child, teen, muscular, pregnant, skeleton, zombie)")
    sprite_path: str = Field(..., description="Relative sprite path for this body type")

    class Config:
        from_attributes = True


class LayerOut(BaseModel):
    layer_number: int = Field(..., description="Layer ordinal (1-based)")
    z_pos: Optional[int] = Field(None, description="Z-position for rendering order (lower = behind)")
    body_types: List[LayerBodyTypeOut] = Field(default_factory=list, description="Body-type-specific sprite paths")

    class Config:
        from_attributes = True


class CreditOut(BaseModel):
    body_type: Optional[str] = None
    authors: Optional[List[str]] = None
    licenses: Optional[List[str]] = None
    urls: Optional[List[str]] = None

    class Config:
        from_attributes = True


class AnimationOut(BaseModel):
    id: int
    name: str = Field(..., description="Animation name (walk, slash, spellcast, …)")
    row: Optional[int] = Field(None, description="Starting row in the spritesheet")
    num_directions: Optional[int] = Field(None, description="Number of directional variants")
    cycle: Optional[str] = None
    custom_cycle: Optional[str] = None

    class Config:
        from_attributes = True


class BodyTypeOut(BaseModel):
    name: str = Field(..., description="Body type identifier used in API calls")
    display_name: Optional[str] = Field(None, description="Human-readable label")
    tags: Optional[List[str]] = Field(None, description="Tags automatically applied when this body type is selected")

    class Config:
        from_attributes = True


class TagOut(BaseModel):
    id: int
    name: str = Field(..., description="Tag identifier")
    item_count: Optional[int] = Field(None, description="Number of items that provide this tag")

    class Config:
        from_attributes = True


# --- Item models (summary vs detail) ---

class ItemSummary(BaseModel):
    """Compact item representation for list endpoints."""
    name: str
    file_name: str = Field(..., description="Unique identifier – use this value in selections")
    type_name: str = Field(..., description="Category (body, hair, legs, torso, cape, …)")
    match_body_color: bool = False
    fit_all_body_types: bool = False
    variants: List[VariantOut] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list, description="Tags this item provides")
    required_tags: List[str] = Field(default_factory=list, description="Tags that must be present for this item to be available")
    excluded_tags: List[str] = Field(default_factory=list, description="Tags that make this item unavailable")
    supported_body_types: List[str] = Field(default_factory=list, description="Body types this item has sprites for")


class ItemDetail(ItemSummary):
    """Full item representation including layers, credits, and animations."""
    layers: List[LayerOut] = Field(default_factory=list)
    credits: List[CreditOut] = Field(default_factory=list)
    animations: List[str] = Field(default_factory=list, description="Supported animation names")
    replace_in_path: Optional[Dict] = Field(None, description="Template variable substitutions")


# --- Request models ---

class SelectionItem(BaseModel):
    type: str = Field(..., description="Category of the item (body, hair, legs, …)")
    item: str = Field(..., description="file_name of the item")
    variant: Optional[str] = Field(None, description="Variant name (colour / style)")

    class Config:
        json_schema_extra = {
            "examples": [
                {"type": "body", "item": "body", "variant": "light"},
                {"type": "hair", "item": "hair_long", "variant": "blonde"},
            ]
        }


class SpriteRequest(BaseModel):
    """Request body for sprite generation."""
    body_type: str = Field(..., description="Body type: male, female, child, teen, muscular, pregnant, skeleton, zombie")
    selections: List[SelectionItem] = Field(
        ...,
        description="List of items to compose into the sprite",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "body_type": "male",
                "selections": [
                    {"type": "body", "item": "body", "variant": "light"},
                    {"type": "head", "item": "heads_human_male"},
                    {"type": "hair", "item": "hair_long", "variant": "blonde"},
                    {"type": "legs", "item": "legs_pants", "variant": "teal"},
                    {"type": "torso", "item": "torso_shirt", "variant": "white"},
                ],
            }
        }


class AvailableOptionsRequest(BaseModel):
    """Request body for querying available options given current state."""
    body_type: str = Field(..., description="Body type to filter compatibility")
    current_selections: Optional[List[SelectionItem]] = Field(
        default_factory=list,
        description="Items already selected – drives tag-based dependency filtering",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "body_type": "male",
                "current_selections": [
                    {"type": "body", "item": "body", "variant": "light"},
                ],
            }
        }


# --- Response models ---

class AvailableOptionItem(BaseModel):
    name: str
    file_name: str
    variants: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)


class AvailableOptionsResponse(BaseModel):
    body_type: str
    available_options: Dict[str, List[AvailableOptionItem]]
    total_categories: int


class RandomCharacterResponse(BaseModel):
    """The selections that make up a randomly generated character."""
    body_type: str
    race: Optional[str] = Field(None, description="Race / species (human, orc, wolf, …)")
    character_class: Optional[str] = Field(None, description="Character class (warrior, mage, …)")
    selections: List[SelectionItem]
    description: str = Field(..., description="Human-readable summary of the character")
    animation_coverage: Optional[Dict[str, Dict]] = Field(None, description="Per-animation coverage: standard sprite availability and oversized variant name")


class CategoryListResponse(BaseModel):
    categories: List[str]
    total: int


class StatsResponse(BaseModel):
    total_items: int
    total_categories: int
    total_tags: int
    total_animations: int
    total_body_types: int
    items_per_category: Dict[str, int]
    items_per_body_type: Dict[str, int]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _item_to_summary(item: Item) -> dict:
    """Convert an ORM Item to an ItemSummary dict."""
    body_types_set = set()
    for layer in item.layers:
        for bt in layer.body_types:
            body_types_set.add(bt.body_type)
    return {
        "name": item.name,
        "file_name": item.file_name,
        "type_name": item.type_name,
        "match_body_color": item.match_body_color,
        "fit_all_body_types": item.fit_all_body_types,
        "variants": [{"name": v.name, "value": v.value, "rgb_values": v.rgb_values} for v in item.variants],
        "tags": [t.name for t in item.tags],
        "required_tags": [t.name for t in item.required_tags],
        "excluded_tags": [t.name for t in item.excluded_tags],
        "supported_body_types": sorted(body_types_set),
    }


def _item_to_detail(item: Item) -> dict:
    """Convert an ORM Item to an ItemDetail dict."""
    d = _item_to_summary(item)
    d["layers"] = [
        {
            "layer_number": l.layer_number,
            "z_pos": l.z_pos,
            "body_types": [{"body_type": bt.body_type, "sprite_path": bt.sprite_path} for bt in l.body_types],
        }
        for l in sorted(item.layers, key=lambda l: l.layer_number)
    ]
    d["credits"] = [
        {
            "body_type": c.body_type,
            "authors": c.authors,
            "licenses": c.licenses,
            "urls": c.urls,
        }
        for c in item.credits
    ]
    d["animations"] = [a.name for a in item.animations]
    d["replace_in_path"] = item.replace_in_path
    return d


def _load_item_eager(db: Session, file_name: str) -> Optional[Item]:
    """Load a single item with all relationships eagerly loaded."""
    return (
        db.query(Item)
        .options(
            joinedload(Item.layers).joinedload(ItemLayer.body_types),
            joinedload(Item.variants),
            joinedload(Item.tags),
            joinedload(Item.required_tags),
            joinedload(Item.excluded_tags),
            joinedload(Item.animations),
            joinedload(Item.credits),
        )
        .filter(Item.file_name == file_name)
        .first()
    )


# Application-level cache for item data (static, never changes at runtime)
_items_cache: Optional[List[dict]] = None


def _load_all_items_for_random(db: Session) -> List[dict]:
    """
    Load all items with relationships, cached in memory after first call.
    Returns lightweight dicts instead of ORM objects to avoid session issues.
    """
    global _items_cache
    if _items_cache is not None:
        return _items_cache

    items = (
        db.query(Item)
        .options(
            joinedload(Item.layers).joinedload(ItemLayer.body_types),
            joinedload(Item.variants),
            joinedload(Item.tags),
            joinedload(Item.required_tags),
            joinedload(Item.excluded_tags),
        )
        .all()
    )

    # Convert to plain dicts so they're session-independent
    _items_cache = []
    for item in items:
        body_types_in_layers = set()
        for layer in item.layers:
            for bt in layer.body_types:
                body_types_in_layers.add(bt.body_type)
        _items_cache.append({
            "file_name": item.file_name,
            "name": item.name,
            "type_name": item.type_name,
            "match_body_color": item.match_body_color,
            "fit_all_body_types": item.fit_all_body_types,
            "variants": [{"name": v.name, "value": v.value} for v in item.variants],
            "tags": [t.name for t in item.tags],
            "required_tags": [t.name for t in item.required_tags],
            "excluded_tags": [t.name for t in item.excluded_tags],
            "body_types": body_types_in_layers,
        })

    return _items_cache


# ---------------------------------------------------------------------------
# Character presets – race + body type combinations
# ---------------------------------------------------------------------------

# Heads per race, split by gender.
# "male_heads" used for: male, muscular, teen
# "female_heads" used for: female, pregnant, teen (teen can use either)
# "any_heads" used when gender distinction doesn't apply (unisex races)
# "child_heads" used for child body type

# Adult male (includes elderly variants)
_HUMAN_MALE_HEADS = [
    "heads_human_male", "heads_human_male_elderly", "heads_human_male_small",
    "heads_human_male_gaunt", "heads_human_male_plump", "heads_human_elderly_small",
]
# Adult female (includes elderly variants)
_HUMAN_FEMALE_HEADS = [
    "heads_human_female", "heads_human_female_elderly", "heads_human_female_small",
    "heads_human_elderly_small",
]
# Teen: young faces only, no elderly
_HUMAN_MALE_TEEN_HEADS = [
    "heads_human_male", "heads_human_male_small", "heads_human_male_gaunt",
]
_HUMAN_FEMALE_TEEN_HEADS = [
    "heads_human_female", "heads_human_female_small",
]

RACE_HEAD_CONFIG: Dict[str, Dict[str, List[str]]] = {
    "human": {
        "male_heads":      _HUMAN_MALE_HEADS,
        "female_heads":    _HUMAN_FEMALE_HEADS,
        "male_teen_heads": _HUMAN_MALE_TEEN_HEADS,
        "female_teen_heads": _HUMAN_FEMALE_TEEN_HEADS,
        "child_heads":     ["heads_human_child"],
    },
    "orc": {
        "male_heads":   ["heads_orc_male"],
        "female_heads": ["heads_orc_female"],
        "child_heads":  ["heads_orc_child"],
    },
    "wolf": {
        "male_heads":   ["heads_wolf_male"],
        "female_heads": ["heads_wolf_female"],
        "child_heads":  ["heads_wolf_child"],
    },
    "lizard": {
        "male_heads":   ["heads_lizard_male"],
        "female_heads": ["heads_lizard_female"],
        "child_heads":  ["heads_lizard_child"],
    },
    "minotaur": {
        "male_heads":   ["heads_minotaur"],
        "female_heads": ["heads_minotaur_female"],
        "child_heads":  ["heads_minotaur_child"],
    },
    "goblin":       {"any_heads": ["heads_goblin"],       "child_heads": ["heads_goblin_child"]},
    "troll":        {"any_heads": ["heads_troll"],         "child_heads": ["heads_troll_child"]},
    "boarman":      {"any_heads": ["heads_boarman"],       "child_heads": ["heads_boarman_child"]},
    "mouse":        {"any_heads": ["heads_mouse"],         "child_heads": ["heads_mouse_child"]},
    "rabbit":       {"any_heads": ["heads_rabbit"],        "child_heads": ["heads_rabbit_child"]},
    "rat":          {"any_heads": ["heads_rat"],           "child_heads": ["heads_rat_child"]},
    "sheep":        {"any_heads": ["heads_sheep"],         "child_heads": ["heads_sheep_child"]},
    "pig":          {"any_heads": ["heads_pig"],           "child_heads": ["heads_pig_child"]},
    "alien":        {"any_heads": ["heads_alien"]},
    "vampire":      {"any_heads": ["heads_vampire"]},
    "frankenstein": {"any_heads": ["heads_frankenstein"]},
    "wartotaur":    {"any_heads": ["heads_wartotaur"]},
    "skeleton":     {"any_heads": ["heads_skeleton"]},
    "zombie":       {"any_heads": ["heads_zombie"]},
    "jack":         {"any_heads": ["heads_jack"]},
}

# Body types considered "male-like" or "female-like" for head selection
_MALE_BODY_TYPES = {"male", "muscular"}
_FEMALE_BODY_TYPES = {"female", "pregnant"}
# "teen" and "child" handled specially


def get_heads_for_race_and_body(race: str, body_type: str) -> List[str]:
    """Get the appropriate head list for a race + body type combination."""
    cfg = RACE_HEAD_CONFIG.get(race)
    if not cfg:
        return []

    if body_type == "child":
        return cfg.get("child_heads", cfg.get("any_heads", []))

    # If the race has gendered heads, pick the right set
    if "male_heads" in cfg or "female_heads" in cfg:
        if body_type in _MALE_BODY_TYPES:
            return cfg.get("male_heads", [])
        elif body_type in _FEMALE_BODY_TYPES:
            return cfg.get("female_heads", [])
        elif body_type == "teen":
            # Teen: use teen-specific heads if available, otherwise fall back to regular
            male_teen = cfg.get("male_teen_heads", cfg.get("male_heads", []))
            female_teen = cfg.get("female_teen_heads", cfg.get("female_heads", []))
            return male_teen + female_teen
        else:
            return cfg.get("male_heads", []) + cfg.get("female_heads", [])

    # Unisex race
    return cfg.get("any_heads", [])

# Thematically appropriate skin colours per race.
# If a race is not listed here it can use any body variant.
_HUMAN_SKINS = ["light", "amber", "olive", "taupe", "bronze", "brown", "black"]
_ORC_SKINS = ["green", "dark_green", "pale_green", "bright_green", "olive", "brown", "taupe", "black"]
_GOBLIN_SKINS = ["green", "pale_green", "bright_green", "dark_green", "olive"]
_FUR_SKINS = ["fur_black", "fur_brown", "fur_copper", "fur_gold", "fur_grey", "fur_tan", "fur_white"]
_LIZARD_SKINS = ["green", "dark_green", "bright_green", "blue", "brown", "black", "olive", "taupe", "bronze"]
_UNDEAD_SKINS = ["zombie_green", "pale_green", "lavender"]

RACE_SKIN_COLORS: Dict[str, List[str]] = {
    "human":        _HUMAN_SKINS,
    "vampire":      _HUMAN_SKINS + ["lavender", "pale_green"],
    "frankenstein": _UNDEAD_SKINS + ["green", "dark_green"],
    "orc":          _ORC_SKINS,
    "goblin":       _GOBLIN_SKINS,
    "troll":        _ORC_SKINS + ["blue", "lavender"],
    "lizard":       _LIZARD_SKINS,
    "wartotaur":    _ORC_SKINS + _LIZARD_SKINS,
    "wolf":         _FUR_SKINS,
    "boarman":      _FUR_SKINS + ["brown", "taupe", "bronze"],
    "mouse":        _FUR_SKINS + ["light", "taupe"],
    "rabbit":       _FUR_SKINS + ["light", "taupe"],
    "rat":          _FUR_SKINS + ["brown", "taupe"],
    "sheep":        _FUR_SKINS + ["light"],
    "pig":          _FUR_SKINS + ["light", "amber", "taupe", "bronze"],
    "minotaur":     _FUR_SKINS + ["brown", "black", "taupe", "bronze"],
    "alien":        ["blue", "green", "bright_green", "pale_green", "lavender", "dark_green"],
    "zombie":       _UNDEAD_SKINS,
    "skeleton":     ["skeleton"],
    "jack":         ["jack"],
}


BODY_TYPE_OPTIONS = ["male", "female", "muscular", "teen", "child", "pregnant"]

# Special body items for skeleton/zombie (they use male proportions)
SPECIAL_BODY_ITEMS = {
    "skeleton": "body_skeleton",
    "zombie":   "body_zombie",
}


class CharacterPreset(BaseModel):
    """A playable race + body type combination."""
    id: str = Field(..., description="Preset identifier to pass to /random-character (e.g. 'human_female')")
    race: str = Field(..., description="Race / species name")
    body_type: str = Field(..., description="Body proportions (male, female, teen, child, muscular, pregnant)")
    display_name: str = Field(..., description="Human-readable label")
    head_options: List[str] = Field(..., description="Head file_names available for this preset")


def _build_presets() -> List[dict]:
    """Build the full list of race + body_type presets."""
    presets = []
    for race in RACE_HEAD_CONFIG:
        # Determine which body types to offer
        if race in SPECIAL_BODY_ITEMS or race == "jack":
            body_types = ["male", "female", "teen"]
        else:
            body_types = BODY_TYPE_OPTIONS

        for bt in body_types:
            heads = get_heads_for_race_and_body(race, bt)
            if not heads:
                continue
            preset_id = f"{race}_{bt}"
            if race == "jack":
                display = f"Jack O'Lantern ({bt.capitalize()})"
            else:
                display = f"{race.capitalize()} ({bt.capitalize()})"
            presets.append({
                "id": preset_id, "race": race, "body_type": bt,
                "display_name": display, "head_options": heads,
            })
    return presets


_PRESETS_CACHE: Optional[List[dict]] = None


def get_presets() -> List[dict]:
    global _PRESETS_CACHE
    if _PRESETS_CACHE is None:
        _PRESETS_CACHE = _build_presets()
    return _PRESETS_CACHE


def find_preset(preset_id: str) -> Optional[dict]:
    """Look up a preset by id (e.g. 'human_female')."""
    for p in get_presets():
        if p["id"] == preset_id:
            return p
    return None


# ---------------------------------------------------------------------------
# Random character generator
# ---------------------------------------------------------------------------

# Upper body clothing – pick from the first category that has compatible items
# Masculine hairstyles – excluded from female characters
_MASCULINE_HAIR = {
    "hair_balding", "hair_buzzcut", "hair_flat_top_fade", "hair_flat_top_straight",
    "hair_high_and_tight", "hair_twists_fade", "hair_cowlick", "hair_cowlick_tall",
    "hair_spiked", "hair_spiked2", "hair_spiked_porcupine",
}

# Feminine hairstyles – preferred for female characters (long, braid, bob, etc.)
_FEMININE_HAIR = {
    "hair_bangs", "hair_bangs_bun", "hair_bangslong", "hair_bangslong2",
    "hair_bob", "hair_bob_side_part", "hair_braid", "hair_braid2", "hair_bunches",
    "hair_curls_large", "hair_curls_large_xlong", "hair_curly_long",
    "hair_curtains_long", "hair_half_up", "hair_high_ponytail",
    "hair_long", "hair_long_band", "hair_long_center_part", "hair_long_messy",
    "hair_long_messy2", "hair_long_straight", "hair_long_tied",
    "hair_lob", "hair_loose", "hair_page", "hair_page2", "hair_pigtails",
    "hair_pigtails_bangs", "hair_pixie", "hair_shoulderl", "hair_shoulderr",
    "hair_swoop", "hair_swoop_side", "hair_topknot_long", "hair_topknot_long2",
    "hair_wavy", "hair_xlong", "hair_xlong_wavy", "hair_dreadlocks_long",
}

# ---------------------------------------------------------------------------
# Character class definitions
# ---------------------------------------------------------------------------
# Each class defines preferred items per category. The randomizer will try to
# pick from these first; if none are compatible it falls back to any item.
# "weapon_chance" controls how likely the class is to get a weapon (0.0-1.0).
# "shield_chance" controls shield likelihood.
# "optional_always" lists categories that should always be included.
# "optional_never" lists categories that should never be included.

CHARACTER_CLASSES: Dict[str, dict] = {
    "warrior": {
        "display_name": "Warrior",
        "upper_body": ["torso_armour_plate", "torso_armour_leather", "torso_armour_legion", "torso_chainmail"],
        "lower_body": ["legs_armour", "legs_pants2", "legs_pants"],
        "weapons": [
            "weapon_sword_longsword", "weapon_sword_longsword_alt", "weapon_sword_arming",
            "weapon_blunt_waraxe", "weapon_blunt_flail", "weapon_blunt_mace",
            "weapon_sword_scimitar",
        ],
        "hats": [
            "hat_helmet_armet", "hat_helmet_armet_simple", "hat_helmet_barbuta",
            "hat_helmet_barbuta_simple", "hat_helmet_greathelm", "hat_helmet_spangenhelm",
            "hat_helmet_spangenhelm_viking", "hat_helmet_close", "hat_helmet_bascinet",
            "hat_helmet_bascinet_round", "hat_helmet_sugarloaf", "hat_helmet_horned",
            "hat_helmet_barbarian", "hat_helmet_barbarian_nasal", "hat_helmet_barbarian_viking",
        ],
        "shields": None,  # any shield
        "shoulders": ["shoulders_plate", "shoulders_legion", "shoulders_leather"],
        "shoes": ["feet_armour", "feet_boots_basic", "feet_boots_revised"],
        "weapon_chance": 1.0,
        "shield_chance": 0.6,
        "optional_always": ["shoulders", "shoes"],
        "optional_never": ["wings", "backpack", "quiver", "necklace", "barrette"],
    },
    "mage": {
        "display_name": "Mage",
        "upper_body": [
            "torso_clothes_longsleeve", "torso_clothes_longsleeve2",
            "torso_clothes_tunic", "dress_kimono",
            "torso_clothes_blouse_longsleeve",
        ],
        "lower_body": ["legs_pants", "legs_hose", "legs_skirt_straight"],
        "weapons": [
            "weapon_magic_wand", "weapon_magic_diamond", "weapon_magic_gnarled",
            "weapon_magic_loop", "weapon_magic_s", "weapon_magic_simple",
        ],
        "hats": [
            "hat_magic_wizard", "hat_magic_celestial", "hat_magic_celestial_moon",
            "hat_magic_large", "hat_hood_cloth",
        ],
        "shields": [],  # no shield
        "shoulders": ["shoulders_mantal"],
        "shoes": ["feet_shoes_revised", "feet_slippers", "feet_sandals"],
        "weapon_chance": 1.0,
        "shield_chance": 0.0,
        "optional_always": ["hat", "cape"],
        "optional_never": ["quiver", "wings", "shoulders"],
        "capes": ["cape_solid"],
    },
    "pirate": {
        "display_name": "Pirate",
        "upper_body": [
            "torso_clothes_longsleeve2_vneck", "torso_clothes_longsleeve2",
            "torso_clothes_sleeveless2_vneck", "torso_clothes_vest_open",
        ],
        "lower_body": ["legs_pantaloons", "legs_pants", "legs_shorts"],
        "weapons": [
            "weapon_sword_saber", "weapon_sword_rapier", "weapon_sword_scimitar",
            "weapon_sword_dagger",
        ],
        "hats": [
            "hat_tricorne", "hat_tricorne_captain", "hat_tricorne_lieutenant",
            "hat_bicorne_athwart_basic", "hat_bicorne_athwart_captain",
            "hat_bicorne_athwart_admiral", "hat_bicorne_foreaft",
            "hat_cap_bonnie", "hat_cap_bonnie_tilt",
        ],
        "shields": [],  # no shield
        "shoulders": ["shoulders_epaulets"],
        "shoes": ["feet_boots_fold", "feet_boots_basic", "feet_boots_revised"],
        "weapon_chance": 1.0,
        "shield_chance": 0.0,
        "optional_always": ["hat", "belt", "shoes"],
        "optional_never": ["wings", "quiver", "backpack", "shoulders"],
        "facial": ["facial_eyepatch_left", "facial_eyepatch_right"],
    },
    "ranger": {
        "display_name": "Ranger",
        "upper_body": [
            "torso_armour_leather", "torso_clothes_longsleeve2_vneck",
            "torso_clothes_longsleeve2", "torso_clothes_tunic",
        ],
        "lower_body": ["legs_pants", "legs_leggings", "legs_leggings2"],
        "weapons": [
            "weapon_ranged_bow_recurve", "weapon_ranged_bow_great",
            "weapon_ranged_bow_normal", "weapon_ranged_crossbow",
        ],
        "hats": ["hat_hood_cloth", "hat_cap_bonnie", "hat_cap_leather"],
        "shields": [],  # no shield
        "shoulders": ["shoulders_leather"],
        "shoes": ["feet_boots_basic", "feet_boots_revised", "feet_boots_fold"],
        "weapon_chance": 1.0,
        "shield_chance": 0.0,
        "optional_always": ["quiver", "cape", "shoes"],
        "optional_never": ["wings", "backpack", "necklace"],
        "capes": ["cape_solid", "cape_tattered"],
    },
    "thief": {
        "display_name": "Thief",
        "upper_body": [
            "torso_clothes_sleeveless", "torso_clothes_sleeveless2",
            "torso_clothes_sleeveless2_vneck", "torso_clothes_vest",
            "torso_clothes_vest_open", "torso_armour_leather",
        ],
        "lower_body": ["legs_pants", "legs_shorts_short", "legs_leggings"],
        "weapons": ["weapon_sword_dagger", "weapon_sword_rapier"],
        "hats": ["hat_hood_cloth", "hat_hood_sack_cloth", "hat_cap_leather"],
        "shields": [],  # no shield
        "shoulders": [],
        "shoes": ["feet_boots_basic", "feet_boots_revised", "feet_sandals"],
        "weapon_chance": 1.0,
        "shield_chance": 0.0,
        "optional_always": ["belt", "shoes"],
        "optional_never": ["wings", "quiver", "backpack", "shoulders"],
        "facial": ["facial_eyepatch_left", "facial_eyepatch_right"],
        "capes": ["cape_tattered"],
    },
    "cleric": {
        "display_name": "Cleric",
        "upper_body": [
            "torso_clothes_robe", "torso_clothes_longsleeve_formal",
            "torso_clothes_longsleeve2", "torso_armour_leather",
        ],
        "lower_body": ["legs_pants", "legs_hose", "legs_skirt_straight"],
        "weapons": [
            "weapon_blunt_mace", "weapon_magic_simple", "weapon_polearm_cane",
        ],
        "hats": ["hat_hood_cloth", "hat_hood_hijab"],
        "shields": ["shield_crusader", "shield_heater_wood", "shield_heater_revised_wood"],
        "shoulders": ["shoulders_mantal", "shoulders_plate"],
        "shoes": ["feet_sandals", "feet_shoes_revised", "feet_slippers"],
        "weapon_chance": 1.0,
        "shield_chance": 0.4,
        "optional_always": ["necklace"],
        "optional_never": ["wings", "quiver", "backpack", "facial"],
    },
    "noble": {
        "display_name": "Noble",
        "upper_body": [
            "torso_clothes_longsleeve_formal", "torso_clothes_longsleeve_formal_striped",
            "torso_jacket_frock", "torso_clothes_longsleeve2_buttoned",
        ],
        "lower_body": ["legs_formal", "legs_formal_striped", "legs_hose"],
        "weapons": ["weapon_sword_rapier", "weapon_sword_arming"],
        "hats_male": ["hat_formal_crown"],
        "hats_female": ["hat_formal_tiara"],
        "hats": ["hat_formal_crown", "hat_formal_tiara"],  # fallback
        "shields": [],  # no shield
        "shoulders": ["shoulders_epaulets", "shoulders_mantal"],
        "shoes": ["feet_shoes_revised", "feet_shoes_ghillies", "feet_shoes_sara"],
        "weapon_chance": 1.0,
        "shield_chance": 0.0,
        "optional_always": ["hat", "necklace", "cape", "shoes"],
        "optional_never": ["wings", "quiver", "backpack", "facial"],
        "capes": ["cape_solid"],
    },
    "guard": {
        "display_name": "Guard",
        "upper_body": [
            "torso_armour_legion", "torso_chainmail", "torso_armour_leather",
        ],
        "lower_body": ["legs_armour", "legs_pants2", "legs_skirts_legion"],
        "weapons": [
            "weapon_polearm_halberd", "weapon_polearm_spear", "weapon_polearm_longspear",
            "weapon_sword_arming", "weapon_sword_longsword",
        ],
        "hats": [
            "hat_helmet_kettle", "hat_helmet_morion", "hat_helmet_spangenhelm",
            "hat_helmet_nasal", "hat_helmet_norman", "hat_helmet_legion",
            "hat_helmet_flattop", "hat_helmet_pointed",
        ],
        "shields": ["shield_kite", "shield_heater_wood", "shield_heater_revised_wood", "shield_scutum"],
        "shoulders": ["shoulders_legion", "shoulders_plate", "shoulders_leather"],
        "shoes": ["feet_armour", "feet_boots_basic", "feet_boots_revised"],
        "weapon_chance": 1.0,
        "shield_chance": 0.5,
        "optional_always": ["hat", "shoulders", "shoes"],
        "optional_never": ["wings", "quiver", "backpack", "necklace", "barrette"],
    },
    "merchant": {
        "display_name": "Merchant",
        "upper_body": [
            "torso_clothes_longsleeve_formal", "torso_clothes_longsleeve2_buttoned",
            "torso_jacket_frock", "torso_clothes_longsleeve2_cardigan",
            "torso_clothes_vest",
        ],
        "lower_body": ["legs_formal", "legs_pants", "legs_hose"],
        "weapons": [],
        "hats": ["hat_formal_tophat", "hat_formal_bowler", "hat_cap_bonnie"],
        "shields": [],
        "shoulders": [],
        "shoes": ["feet_shoes_revised", "feet_shoes_ghillies", "feet_shoes_basic"],
        "weapon_chance": 0.0,
        "shield_chance": 0.0,
        "optional_always": ["necklace", "shoes", "belt"],
        "optional_never": ["wings", "quiver", "shoulders", "facial"],
        "backpacks": ["backpack_basket", "backpack_basket_contents", "backpack_squarepack"],
    },
    "peasant": {
        "display_name": "Peasant",
        "upper_body": [
            "torso_clothes_shortsleeve", "torso_clothes_tshirt", "torso_clothes_tshirt_vneck",
            "torso_clothes_tunic", "torso_clothes_tunic_sara",
            "torso_aprons_overalls", "torso_aprons_suspenders",
        ],
        "lower_body": ["legs_pants", "legs_shorts", "legs_shorts_short", "legs_widepants"],
        "weapons": ["tool_rod", "tool_smash", "tool_thrust", "weapon_polearm_scythe"],
        "hats": ["hat_cap_bonnie", "hat_cap_bonnie_tilt", "hat_hood_sack_cloth"],
        "shields": [],
        "shoulders": [],
        "shoes": ["feet_sandals", "feet_boots_basic", "feet_shoes_basic"],
        "weapon_chance": 0.5,
        "shield_chance": 0.0,
        "optional_always": ["shoes"],
        "optional_never": ["wings", "quiver", "backpack", "shoulders", "necklace", "facial"],
    },
}

ALL_CLASS_NAMES = list(CHARACTER_CLASSES.keys())

UPPER_BODY_CATEGORIES = ["clothes", "vest", "dress", "jacket", "armour", "chainmail", "overalls"]
# Lower body clothing
LOWER_BODY_CATEGORIES = ["legs"]
# Categories to randomly pick from
OPTIONAL_CATEGORIES = [
    "facial", "feet", "arms", "hands",
    "belt", "cape", "hat", "barrette",
    "shoulders", "necklace", "buckle",
    "quiver", "backpack", "wings", "shoes",
]
# Weapon / accessory categories – pick at most one
WEAPON_CATEGORIES = ["weapon", "shield"]


def generate_random_character(
    db: Session,
    body_type: Optional[str] = None,
    race: Optional[str] = None,
    preset: Optional[str] = None,
    age: Optional[str] = None,
    character_class: Optional[str] = None,
) -> dict:
    """
    Build a random but valid character selection set.

    Args:
        db: Database session
        body_type: Body build / gender (male, female, child, muscular, pregnant).
                   Ignored if preset is provided.
        race: Race/species name (human, orc, wolf, …). Constrains head selection.
              Ignored if preset is provided.
        preset: Preset id like 'human_female' that sets both race and body_type.
        age: Age category – 'child', 'teen', 'adult' (default), or 'elderly'.
             child: uses child body proportions and child heads.
             teen: uses teen body proportions; head gender from body_type.
             elderly: allows elderly head variants.
             Only applies to human; non-human races ignore this.
    """
    all_items = _load_all_items_for_random(db)

    if not age:
        age = "adult"

    # --- resolve preset / race / body_type ---
    allowed_heads: Optional[List[str]] = None  # None = any head
    original_race: Optional[str] = None
    # head_gender tracks which gendered heads to use (separate from body_type
    # so that age=teen + body_type=female gives female teen heads on a teen body)
    head_gender: Optional[str] = body_type

    if preset:
        p = find_preset(preset)
        if p:
            body_type = p["body_type"]
            original_race = p["race"]
            allowed_heads = p["head_options"]
            head_gender = body_type
        else:
            pass

    if race and not preset:
        original_race = race
        if not body_type:
            matching = [p for p in get_presets() if p["race"] == race]
            # Exclude teen/child presets – age dropdown handles those now
            matching = [p for p in matching if p["body_type"] not in ("teen", "child")]
            if matching:
                p = random.choice(matching)
                body_type = p["body_type"]
            else:
                body_type = random.choice(["male", "female"])
            head_gender = body_type

    if body_type and not original_race and not preset:
        matching = [p for p in get_presets() if p["body_type"] == body_type]
        if matching:
            p = random.choice(matching)
            original_race = p["race"]
            allowed_heads = p["head_options"]

    if not body_type and not preset:
        p = random.choice([p for p in get_presets() if p["body_type"] not in ("teen", "child")])
        body_type = p["body_type"]
        original_race = p["race"]
        allowed_heads = p["head_options"]
        head_gender = body_type

    if not body_type:
        body_type = random.choice(["male", "female"])

    if not head_gender:
        head_gender = body_type

    # --- Apply age ---
    # For non-human races, force age back to adult (only human has age variants)
    if original_race and original_race != "human" and age in ("teen", "child", "elderly"):
        age = "adult"

    if age == "child":
        head_gender = body_type
        if original_race:
            allowed_heads = RACE_HEAD_CONFIG.get(original_race, {}).get("child_heads", [])
        body_type = "child"

    elif age == "teen":
        head_gender = body_type  # remember gender before overriding body
        # Re-resolve heads using the teen body type but gendered head key
        if original_race:
            cfg = RACE_HEAD_CONFIG.get(original_race, {})
            if head_gender in _MALE_BODY_TYPES:
                allowed_heads = cfg.get("male_teen_heads", cfg.get("male_heads", cfg.get("any_heads", [])))
            elif head_gender in _FEMALE_BODY_TYPES:
                allowed_heads = cfg.get("female_teen_heads", cfg.get("female_heads", cfg.get("any_heads", [])))
            else:
                allowed_heads = get_heads_for_race_and_body(original_race, "teen")
        body_type = "teen"  # override body proportions

    # Re-resolve allowed_heads if not yet set (e.g. body_type given but no race)
    if allowed_heads is None and original_race:
        head_bt = body_type if age != "teen" else head_gender
        allowed_heads = get_heads_for_race_and_body(original_race, head_bt or body_type)

    # Filter elderly heads based on age
    if allowed_heads and age != "elderly":
        allowed_heads = [h for h in allowed_heads if "elderly" not in h]
    elif allowed_heads and age == "elderly":
        # Prefer elderly heads when age=elderly, but keep all as fallback
        elderly_heads = [h for h in allowed_heads if "elderly" in h]
        if elderly_heads:
            allowed_heads = elderly_heads

    # Index items by type_name
    items_by_type: Dict[str, List[dict]] = {}
    for item in all_items:
        items_by_type.setdefault(item["type_name"], []).append(item)

    # Resolve class config
    cls_cfg = CHARACTER_CLASSES.get(character_class, {}) if character_class else {}

    selections: List[dict] = []
    active_tags: set = set()
    used_types: set = set()
    body_color: Optional[str] = None

    def _is_compatible(item: dict) -> bool:
        has_bt = item["fit_all_body_types"] or body_type in item["body_types"]
        if not has_bt:
            return False
        for rt in item["required_tags"]:
            if rt not in active_tags:
                return False
        for et in item["excluded_tags"]:
            if et in active_tags:
                return False
        return True

    def _pick_variant(item: dict) -> Optional[str]:
        if not item["variants"]:
            return None
        if item["match_body_color"] and body_color:
            matching = [v for v in item["variants"] if v["name"] == body_color]
            if matching:
                return matching[0]["name"]
        return random.choice(item["variants"])["name"]

    def _can_match_body_color(item: dict) -> bool:
        if not item["match_body_color"] or not body_color:
            return True
        return any(v["name"] == body_color for v in item["variants"])

    def _pick_from_category(category: str, restrict_to: Optional[List[str]] = None) -> bool:
        nonlocal body_color
        candidates = [i for i in items_by_type.get(category, []) if _is_compatible(i)]
        if restrict_to is not None:
            candidates = [i for i in candidates if i["file_name"] in restrict_to]
        if not candidates:
            return False
        if body_color:
            good = [i for i in candidates if _can_match_body_color(i)]
            if good:
                candidates = good
        item = random.choice(candidates)
        variant = _pick_variant(item)
        if category == "body" and variant:
            body_color = variant
        selections.append({
            "type": item["type_name"],
            "item": item["file_name"],
            "variant": variant,
        })
        active_tags.update(item["tags"])
        used_types.add(category)
        return True

    def _pick_prefer(category: str, preferred: Optional[List[str]]) -> bool:
        """Pick from preferred items if any are compatible, otherwise fall back."""
        if preferred:
            if _pick_from_category(category, restrict_to=preferred):
                return True
        # Fallback: pick any compatible item in this category
        return _pick_from_category(category)

    # Helper: pick a race-appropriate skin colour from a body item's variants
    def _pick_skin_variant(body_item: dict) -> Optional[str]:
        if not body_item["variants"]:
            return None
        allowed_skins = RACE_SKIN_COLORS.get(original_race) if original_race else None
        if allowed_skins:
            good = [v for v in body_item["variants"] if v["name"] in allowed_skins]
            if good:
                return random.choice(good)["name"]
        return random.choice(body_item["variants"])["name"]

    # Step 1 – body
    if original_race and original_race in SPECIAL_BODY_ITEMS:
        # Skeleton/zombie use a special body item with male proportions
        special_file = SPECIAL_BODY_ITEMS[original_race]
        special_items = [i for i in items_by_type.get("body", []) if i["file_name"] == special_file]
        if special_items:
            body_item = special_items[0]
            variant = _pick_skin_variant(body_item)
            body_color = variant
            selections.append({"type": "body", "item": body_item["file_name"], "variant": variant})
            active_tags.update(body_item["tags"])
            used_types.add("body")
            body_type = "male"  # skeleton/zombie use male proportions for item lookup
        else:
            _pick_from_category("body")
    else:
        # Normal – prefer standard "body" item
        body_candidates = [i for i in items_by_type.get("body", []) if _is_compatible(i)]
        standard_bodies = [i for i in body_candidates if i["file_name"] == "body"]
        if standard_bodies:
            body_item = standard_bodies[0]
            variant = _pick_skin_variant(body_item)
            body_color = variant
            selections.append({"type": "body", "item": body_item["file_name"], "variant": variant})
            active_tags.update(body_item["tags"])
            used_types.add("body")
        else:
            _pick_from_category("body")

    # Step 2 – head (constrained to race's heads if specified)
    _pick_from_category("head", restrict_to=allowed_heads)

    # Step 2.5 – default neutral expression (if human tag is active)
    if "human" in active_tags:
        _pick_from_category("expression", restrict_to=["face_neutral"])

    # Step 3 – upper body clothing (class-preferred)
    if cls_cfg.get("upper_body"):
        # Try class-preferred items in their respective categories first
        placed_upper = False
        for cat in UPPER_BODY_CATEGORIES:
            preferred_in_cat = [fn for fn in cls_cfg["upper_body"]
                                if any(i["file_name"] == fn and i["type_name"] == cat
                                       for i in items_by_type.get(cat, []))]
            if preferred_in_cat and _pick_from_category(cat, restrict_to=preferred_in_cat):
                placed_upper = True
                break
        if not placed_upper:
            for cat in UPPER_BODY_CATEGORIES:
                if _pick_from_category(cat):
                    break
    else:
        for cat in UPPER_BODY_CATEGORIES:
            if _pick_from_category(cat):
                break

    # Step 4 – lower body clothing (class-preferred)
    _pick_prefer("legs", cls_cfg.get("lower_body"))

    # Step 4.5 – hair (mandatory, gender-filtered)
    if original_race not in ("skeleton", "zombie"):
        hair_items = [i for i in items_by_type.get("hair", []) if _is_compatible(i)]
        if body_type in _FEMALE_BODY_TYPES:
            feminine = [i for i in hair_items if i["file_name"] in _FEMININE_HAIR]
            if feminine:
                hair_items = feminine
            else:
                hair_items = [i for i in hair_items if i["file_name"] not in _MASCULINE_HAIR]
        elif body_type in _MALE_BODY_TYPES:
            hair_items = [i for i in hair_items if i["file_name"] not in {
                "hair_pigtails", "hair_pigtails_bangs", "hair_bunches",
                "hair_high_ponytail",
            }]
        if hair_items:
            if body_color:
                good = [i for i in hair_items if _can_match_body_color(i)]
                if good:
                    hair_items = good
            item = random.choice(hair_items)
            variant = _pick_variant(item)
            selections.append({
                "type": item["type_name"],
                "item": item["file_name"],
                "variant": variant,
            })
            active_tags.update(item["tags"])
            used_types.add("hair")

    # Step 5 – optional categories (class-aware)
    cls_always = set(cls_cfg.get("optional_always", []))
    cls_never = set(cls_cfg.get("optional_never", []))

    # Resolve class-preferred items for a category (with gendered hat support)
    _CAT_KEY_MAP = {
        "hat": "hats", "cape": "capes", "shoes": "shoes",
        "shoulders": "shoulders", "necklace": None, "belt": None,
        "facial": "facial", "backpack": "backpacks", "quiver": None,
    }

    def _get_class_preferred(cat: str) -> Optional[List[str]]:
        if not cls_cfg:
            return None
        # Gendered hat support: hats_male / hats_female
        if cat == "hat":
            if body_type in _MALE_BODY_TYPES and "hats_male" in cls_cfg:
                return cls_cfg["hats_male"]
            if body_type in _FEMALE_BODY_TYPES and "hats_female" in cls_cfg:
                return cls_cfg["hats_female"]
        pref_key = _CAT_KEY_MAP.get(cat)
        return cls_cfg.get(pref_key) if pref_key else None

    # Always-include categories for this class
    for cat in cls_always:
        if cat not in used_types:
            _pick_prefer(cat, _get_class_preferred(cat))

    # Random optional categories (excluding never-list and already-used)
    available_optional = [c for c in OPTIONAL_CATEGORIES if c not in used_types and c not in cls_never]
    num_optional = random.randint(2, min(5, len(available_optional)))
    chosen_optional = random.sample(available_optional, min(num_optional, len(available_optional)))
    for cat in chosen_optional:
        if cat not in used_types:
            _pick_prefer(cat, _get_class_preferred(cat))

    # Step 6 – second pass for tag-dependent items (e.g. cape_trim after cape)
    # Skip expression variants – we already set a neutral expression
    _SKIP_TAG_DEPENDENT = {"expression", "expression_crying"}
    for cat in list(items_by_type.keys()):
        if cat in used_types or cat in _SKIP_TAG_DEPENDENT:
            continue
        if cat in cls_never:
            continue
        candidates = [i for i in items_by_type.get(cat, []) if i["required_tags"] and _is_compatible(i)]
        if candidates and random.random() < 0.4:
            item = random.choice(candidates)
            variant = _pick_variant(item)
            selections.append({
                "type": item["type_name"],
                "item": item["file_name"],
                "variant": variant,
            })
            active_tags.update(item["tags"])
            used_types.add(cat)

    # Step 7 – weapons (class-aware)
    weapon_chance = cls_cfg.get("weapon_chance", 0.5)
    shield_chance = cls_cfg.get("shield_chance", 0.3)
    if random.random() < weapon_chance:
        _pick_prefer("weapon", cls_cfg.get("weapons"))
    if random.random() < shield_chance:
        shields_pref = cls_cfg.get("shields")
        # shields=None means any shield, shields=[] means no shield
        if shields_pref is None:
            _pick_from_category("shield")
        elif shields_pref:
            _pick_prefer("shield", shields_pref)

    # Build description
    class_label = cls_cfg.get("display_name", "") if cls_cfg else ""
    race_label = original_race.capitalize() if original_race else ""
    title_parts = [p for p in [race_label, class_label, body_type] if p]
    parts = [" ".join(title_parts) + " character"]
    for sel in selections:
        desc = sel["item"].replace("_", " ")
        if sel.get("variant"):
            desc = f"{sel['variant']} {desc}"
        parts.append(desc)

    return {
        "body_type": body_type,
        "race": original_race,
        "character_class": character_class,
        "selections": selections,
        "description": ", ".join(parts),
    }


# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    print("Starting up...")
    try:
        init_database()
        print("PostgreSQL database tables verified")
    except Exception as e:
        print(f"PostgreSQL initialization note: {e}")
    await MongoDBConnection.connect()
    yield
    print("Shutting down...")
    await MongoDBConnection.disconnect()


app = FastAPI(
    title="Alkema Character API",
    version="3.0.0",
    description="""
## LPC Character Customization API

Comprehensive API for the **Liberated Pixel Cup** character generator.
Browse every available item, variant, body type, tag, and animation
stored in the database – then compose them into a spritesheet PNG.

### Key concepts
- **Body types**: male, female, teen, child, muscular, pregnant, skeleton, zombie
- **Items**: individual sprite assets (hair, torso, legs, capes, weapons …)
- **Variants**: colour / style options within an item (e.g. blonde, teal)
- **Tags**: dependency system – items can *provide*, *require*, or *exclude* tags
- **Layers**: each item has one or more z-ordered layers composited together

### Quick start
1. `GET /body-types` – pick a body type
2. `POST /available-options` – see what items are available for that body type
3. `POST /generate-sprite` – compose selections into a PNG spritesheet
4. `GET /random-character` – generate a fully random valid character
5. `GET /random-character/sprite` – get a random character as a PNG image
""",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Sprite-Meta", "X-Character-Data"],
)

app.include_router(game_router)


def get_db():
    db = create_session()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Endpoints – General
# ---------------------------------------------------------------------------

@app.get("/", tags=["General"])
async def root():
    """API root – lists all available endpoint groups."""
    return {
        "message": "Alkema Character API v3",
        "docs": "/docs",
        "endpoints": {
            "sprite_generation": {
                "generate": "POST /generate-sprite",
                "available_options": "POST /available-options",
                "random_character": "GET /random-character",
                "random_sprite": "GET /random-character/sprite",
            },
            "browsing": {
                "body_types": "GET /body-types",
                "categories": "GET /categories",
                "items_by_category": "GET /items/{category}",
                "item_detail": "GET /item/{file_name}",
                "search_items": "GET /items",
                "tags": "GET /tags",
                "animations": "GET /animations",
                "stats": "GET /stats",
            },
            "game_data": {
                "players": "/game/players/*",
                "characters": "/game/characters/*",
                "sessions": "/game/sessions/*",
                "admin": "/game/admin/*",
            },
            "health": "GET /health",
        },
    }


@app.get("/health", tags=["General"])
async def health_check():
    """Health check – reports database connectivity."""
    mongodb_status = "connected" if MongoDBConnection.client else "disconnected"
    return {"status": "healthy", "postgresql": "connected", "mongodb": mongodb_status}


@app.get("/stats", response_model=StatsResponse, tags=["General"])
async def get_stats(db: Session = Depends(get_db)):
    """
    Database statistics – total counts of items, categories, tags, animations,
    body types, plus breakdowns by category and body type.
    """
    total_items = db.query(func.count(Item.id)).scalar()
    cats = db.query(Item.type_name, func.count(Item.id)).group_by(Item.type_name).all()
    total_tags = db.query(func.count(Tag.id)).scalar()
    total_animations = db.query(func.count(Animation.id)).scalar()
    total_body_types = db.query(func.count(BodyType.id)).scalar()

    # Items per body type
    bt_counts: Dict[str, int] = {}
    for bt in db.query(BodyType).all():
        count = (
            db.query(func.count(distinct(Item.id)))
            .join(Item.layers)
            .join(ItemLayer.body_types)
            .filter(ItemLayerBodyType.body_type == bt.name)
            .scalar()
        )
        bt_counts[bt.name] = count

    return {
        "total_items": total_items,
        "total_categories": len(cats),
        "total_tags": total_tags,
        "total_animations": total_animations,
        "total_body_types": total_body_types,
        "items_per_category": {name: cnt for name, cnt in sorted(cats)},
        "items_per_body_type": bt_counts,
    }


# ---------------------------------------------------------------------------
# Endpoints – Body Types
# ---------------------------------------------------------------------------

@app.get("/body-types", response_model=List[BodyTypeOut], tags=["Body Types"])
async def get_body_types(db: Session = Depends(get_db)):
    """List all available body types with their tags."""
    return [
        {"name": bt.name, "display_name": bt.display_name, "tags": bt.tags}
        for bt in db.query(BodyType).order_by(BodyType.name).all()
    ]


# ---------------------------------------------------------------------------
# Endpoints – Categories
# ---------------------------------------------------------------------------

@app.get("/categories", response_model=CategoryListResponse, tags=["Categories"])
async def get_categories(db: Session = Depends(get_db)):
    """List all item categories/types (body, hair, legs, torso, cape, …)."""
    cats = db.query(distinct(Item.type_name)).order_by(Item.type_name).all()
    names = [c[0] for c in cats]
    return {"categories": names, "total": len(names)}


# ---------------------------------------------------------------------------
# Endpoints – Tags
# ---------------------------------------------------------------------------

@app.get("/tags", response_model=List[TagOut], tags=["Tags"])
async def get_tags(db: Session = Depends(get_db)):
    """
    List all tags in the system.

    Tags drive the dependency system:
    - Items **provide** tags (e.g. a backpack provides the "back" tag)
    - Items can **require** tags to be present before they appear
    - Items can **exclude** tags to disappear when those tags are present
    """
    tags = db.query(Tag).order_by(Tag.name).all()
    result = []
    for t in tags:
        count = db.query(func.count(item_tags.c.item_id)).filter(item_tags.c.tag_id == t.id).scalar()
        result.append({"id": t.id, "name": t.name, "item_count": count})
    return result


@app.get("/tags/{tag_name}/items", response_model=List[ItemSummary], tags=["Tags"])
async def get_items_by_tag(tag_name: str, db: Session = Depends(get_db)):
    """Get all items that **provide** a specific tag."""
    tag = db.query(Tag).filter(Tag.name == tag_name).first()
    if not tag:
        raise HTTPException(404, f"Tag '{tag_name}' not found")
    items = (
        db.query(Item)
        .join(item_tags)
        .filter(item_tags.c.tag_id == tag.id)
        .options(
            joinedload(Item.layers).joinedload(ItemLayer.body_types),
            joinedload(Item.variants),
            joinedload(Item.tags),
            joinedload(Item.required_tags),
            joinedload(Item.excluded_tags),
        )
        .all()
    )
    return [_item_to_summary(i) for i in items]


@app.get("/tags/{tag_name}/dependents", response_model=List[ItemSummary], tags=["Tags"])
async def get_items_requiring_tag(tag_name: str, db: Session = Depends(get_db)):
    """Get all items that **require** a specific tag (dependents)."""
    tag = db.query(Tag).filter(Tag.name == tag_name).first()
    if not tag:
        raise HTTPException(404, f"Tag '{tag_name}' not found")
    items = (
        db.query(Item)
        .join(item_required_tags)
        .filter(item_required_tags.c.tag_id == tag.id)
        .options(
            joinedload(Item.layers).joinedload(ItemLayer.body_types),
            joinedload(Item.variants),
            joinedload(Item.tags),
            joinedload(Item.required_tags),
            joinedload(Item.excluded_tags),
        )
        .all()
    )
    return [_item_to_summary(i) for i in items]


# ---------------------------------------------------------------------------
# Endpoints – Animations
# ---------------------------------------------------------------------------

@app.get("/animations", response_model=List[AnimationOut], tags=["Animations"])
async def get_animations(db: Session = Depends(get_db)):
    """List all animation definitions (walk, slash, spellcast, …)."""
    return db.query(Animation).order_by(Animation.row).all()


# ---------------------------------------------------------------------------
# Endpoints – Items (browsing)
# ---------------------------------------------------------------------------

@app.get("/items", response_model=List[ItemSummary], tags=["Items"])
async def search_items(
    db: Session = Depends(get_db),
    q: Optional[str] = Query(None, description="Search items by name (case-insensitive substring match)"),
    category: Optional[str] = Query(None, description="Filter by category / type_name"),
    body_type: Optional[str] = Query(None, description="Only items compatible with this body type"),
    tag: Optional[str] = Query(None, description="Only items that provide this tag"),
    required_tag: Optional[str] = Query(None, description="Only items that require this tag"),
    has_variants: Optional[bool] = Query(None, description="Filter to items that do/don't have variants"),
    limit: int = Query(100, ge=1, le=1000, description="Max results"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
):
    """
    Search and filter items across the entire database.

    Combine query parameters to narrow results. All filters are AND-ed.
    """
    query = db.query(Item).options(
        joinedload(Item.layers).joinedload(ItemLayer.body_types),
        joinedload(Item.variants),
        joinedload(Item.tags),
        joinedload(Item.required_tags),
        joinedload(Item.excluded_tags),
    )

    if q:
        query = query.filter(Item.name.ilike(f"%{q}%"))
    if category:
        query = query.filter(Item.type_name == category)
    if tag:
        query = query.join(item_tags).join(Tag).filter(Tag.name == tag)
    if required_tag:
        query = query.join(item_required_tags, Item.id == item_required_tags.c.item_id).join(
            Tag, Tag.id == item_required_tags.c.tag_id
        ).filter(Tag.name == required_tag)

    items = query.order_by(Item.type_name, Item.name).all()

    # Post-query filters (need relationship data)
    results = []
    for item in items:
        if body_type:
            has_bt = item.fit_all_body_types or any(
                bt.body_type == body_type for layer in item.layers for bt in layer.body_types
            )
            if not has_bt:
                continue
        if has_variants is True and not item.variants:
            continue
        if has_variants is False and item.variants:
            continue
        results.append(_item_to_summary(item))

    return results[offset : offset + limit]


@app.get("/items/{category}", response_model=List[ItemSummary], tags=["Items"])
async def get_items_by_category(
    category: str,
    body_type: Optional[str] = Query(None, description="Filter to items compatible with this body type"),
    db: Session = Depends(get_db),
):
    """
    Get all items in a specific category.

    Categories correspond to `type_name` values (body, hair, legs, torso, cape,
    belt, hat, helmet, weapon, shield, facial, arms, feet, eyes, …).
    """
    items = (
        db.query(Item)
        .filter(Item.type_name == category)
        .options(
            joinedload(Item.layers).joinedload(ItemLayer.body_types),
            joinedload(Item.variants),
            joinedload(Item.tags),
            joinedload(Item.required_tags),
            joinedload(Item.excluded_tags),
        )
        .order_by(Item.name)
        .all()
    )

    if not items:
        raise HTTPException(404, f"No items found for category '{category}'")

    if body_type:
        items = [
            i for i in items
            if i.fit_all_body_types or any(
                bt.body_type == body_type for layer in i.layers for bt in layer.body_types
            )
        ]

    return [_item_to_summary(i) for i in items]


@app.get("/item/{file_name}", response_model=ItemDetail, tags=["Items"])
async def get_item_detail(file_name: str, db: Session = Depends(get_db)):
    """
    Get full details for a single item including layers, credits, animations,
    and template replacement rules.
    """
    item = _load_item_eager(db, file_name)
    if not item:
        raise HTTPException(404, f"Item '{file_name}' not found")
    return _item_to_detail(item)


# ---------------------------------------------------------------------------
# Endpoints – Sprite generation
# ---------------------------------------------------------------------------

@app.post(
    "/generate-sprite",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}, "description": "Spritesheet PNG"}},
    tags=["Sprite Generation"],
)
async def generate_sprite(request: SpriteRequest, db: Session = Depends(get_db)):
    """
    Generate a character spritesheet PNG from a list of item selections.

    The sprite is composited from all selected items' layers in z-order.
    Each item selection needs:
    - `type` – the category (for documentation only)
    - `item` – the `file_name` of the item
    - `variant` – (optional) the variant name for colour/style

    Returns a **832 × 3392 px** PNG spritesheet (13 columns × 53 rows of 64 × 64 sprites)
    containing all animation frames.
    """
    try:
        generator = SpriteGenerator(db)
        image_bytes, custom_layout = generator.generate_spritesheet(
            request.body_type,
            [s.model_dump() for s in request.selections],
        )
        coverage = generator.get_animation_coverage(
            [s.model_dump() for s in request.selections],
        )
        import json as _json
        metadata = {
            'custom_animations': custom_layout,
            'animation_coverage': coverage,
        }
        return Response(
            content=image_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": "inline; filename=character.png",
                "X-Sprite-Meta": _json.dumps(metadata),
            },
        )
    except Exception as e:
        raise HTTPException(500, f"Error generating sprite: {e}")


@app.post("/available-options", response_model=AvailableOptionsResponse, tags=["Sprite Generation"])
async def get_available_options(request: AvailableOptionsRequest, db: Session = Depends(get_db)):
    """
    Get available customization options given a body type and current selections.

    This endpoint respects the **tag-based dependency system**:
    - Items with `required_tags` only appear when those tags are provided by current selections
    - Items with `excluded_tags` disappear when those tags are present
    - Only items compatible with the selected body type are returned

    Use this iteratively: after adding an item (e.g. a cape), call again to discover
    newly available items (e.g. cape_trim, which requires the "cape" tag).
    """
    try:
        generator = SpriteGenerator(db)
        sels = [s.model_dump() for s in request.current_selections] if request.current_selections else []
        options = generator.get_available_options(request.body_type, sels)
        return {
            "body_type": request.body_type,
            "available_options": options,
            "total_categories": len(options),
        }
    except Exception as e:
        raise HTTPException(500, f"Error fetching options: {e}")


@app.post("/supported-animations", tags=["Sprite Generation"])
async def get_supported_animations(request: SpriteRequest, db: Session = Depends(get_db)):
    """
    Get the intersection of animations supported by ALL selected items.

    Returns which animations will render completely (all layers present)
    and which animations are missing support from specific items.
    """
    try:
        generator = SpriteGenerator(db)
        sels = [s.model_dump() for s in request.selections]
        result = generator.get_supported_animations(sels)
        result['animation_coverage'] = generator.get_animation_coverage(sels)
        return result
    except Exception as e:
        raise HTTPException(500, f"Error checking animations: {e}")


@app.get("/admin/animation-audit", tags=["Admin"])
async def animation_audit(db: Session = Depends(get_db)):
    """
    Audit report of animation support across all items.
    Reads from the DB (populated during ingestion by the filesystem scanner).
    """
    try:
        items = (
            db.query(Item)
            .options(joinedload(Item.animations))
            .all()
        )

        details = []
        full_support_count = 0
        no_support_count = 0

        for item in items:
            anim_names = sorted([a.name for a in item.animations])
            count = len(anim_names)
            if count == 15:
                full_support_count += 1
            elif count == 0:
                no_support_count += 1
            details.append({
                "file_name": item.file_name,
                "name": item.name,
                "type_name": item.type_name,
                "supported_animations": anim_names,
                "count": count,
            })

        details.sort(key=lambda x: x["count"])

        return {
            "total_items": len(items),
            "items_with_full_support": full_support_count,
            "items_with_no_support": no_support_count,
            "items_with_limited_support": len(items) - full_support_count - no_support_count,
            "details": details,
        }
    except Exception as e:
        raise HTTPException(500, f"Error generating audit: {e}")


# ---------------------------------------------------------------------------
# Endpoints – Random character generation
# ---------------------------------------------------------------------------

@app.get("/presets", response_model=List[CharacterPreset], tags=["Random Character"])
async def list_presets():
    """
    List all available character presets (race + body type combinations).

    Each preset has an `id` you can pass to `/random-character?preset=human_female`
    to generate a character of that specific race and body type.

    Races include: Human, Orc, Wolf, Lizard, Minotaur, Goblin, Troll,
    Boarman, Mouse, Rabbit, Rat, Sheep, Pig, Alien, Vampire, Frankenstein,
    Wartotaur, Skeleton, Zombie, Jack O'Lantern.

    Each race is available in multiple body types: Male, Female, Teen,
    Muscular, Pregnant, Child (where applicable).
    """
    return get_presets()


@app.get("/classes", tags=["Random Character"])
async def list_classes():
    """List all available character classes and their display names."""
    return [{"id": k, "display_name": v["display_name"]} for k, v in CHARACTER_CLASSES.items()]


@app.get("/random-character", response_model=RandomCharacterResponse, tags=["Random Character"])
async def random_character(
    preset: Optional[str] = Query(None, description="Preset id like 'human_female', 'orc_male' (see /presets)"),
    race: Optional[str] = Query(None, description="Race name (human, orc, wolf, …) — constrains head selection"),
    body_type: Optional[str] = Query(None, description="Body build / gender (male, female, muscular, pregnant)"),
    age: Optional[str] = Query(None, description="Age category: 'child', 'teen', 'adult' (default), or 'elderly'. Human only."),
    character_class: Optional[str] = Query(None, alias="class", description="Character class: warrior, mage, pirate, ranger, thief, cleric, noble, guard, merchant, peasant"),
    db: Session = Depends(get_db),
):
    """
    Generate a completely random but **valid** character.

    Use `race` and/or `body_type` individually. If nothing is specified, a random preset is chosen.

    Use `age` to control the age category (**human only** — ignored for other races):
    - **child**, **teen**, **adult** (default), **elderly**

    Use `class` to bias equipment toward a character archetype:
    - **warrior**: plate armour, helmets, swords, shields
    - **mage**: robes, wizard hats, magic staves/wands
    - **pirate**: tricorn hats, sabers, open shirts
    - **ranger**: leather armour, bows, quiver, hoods
    - **thief**: sleeveless/vest, daggers, hoods
    - **cleric**: robes, maces, necklaces, crusader shields
    - **noble**: formal clothing, crowns, capes, rapiers
    - **guard**: legion armour, polearms, kettle helmets
    - **merchant**: formal suits, tophats, no weapons
    - **peasant**: simple shirts, overalls, farm tools
    """
    result = generate_random_character(db, body_type=body_type, race=race, preset=preset, age=age, character_class=character_class)
    generator = SpriteGenerator(db)
    result['animation_coverage'] = generator.get_animation_coverage(result['selections'])
    return result


@app.get(
    "/random-character/sprite",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}, "description": "Random character spritesheet PNG"}},
    tags=["Random Character"],
)
async def random_character_sprite(
    preset: Optional[str] = Query(None, description="Preset id like 'human_female', 'orc_male' (see /presets)"),
    race: Optional[str] = Query(None, description="Race name (human, orc, wolf, …)"),
    body_type: Optional[str] = Query(None, description="Body build / gender (male, female, muscular, pregnant)"),
    age: Optional[str] = Query(None, description="Age category: 'child', 'teen', 'adult' (default), or 'elderly'. Human only."),
    character_class: Optional[str] = Query(None, alias="class", description="Character class (warrior, mage, …)"),
    db: Session = Depends(get_db),
):
    """
    Generate a random character and return its spritesheet PNG directly.

    Combines `/random-character` + `/generate-sprite` in one call.
    The selection data is included in the `X-Character-Data` response header as JSON.
    """
    import json as _json

    char_data = generate_random_character(db, body_type=body_type, race=race, preset=preset, age=age, character_class=character_class)
    try:
        generator = SpriteGenerator(db)
        image_bytes, custom_layout = generator.generate_spritesheet(
            char_data["body_type"],
            char_data["selections"],
        )
        coverage = generator.get_animation_coverage(char_data["selections"])
        char_data['custom_animations'] = custom_layout
        char_data['animation_coverage'] = coverage
        return Response(
            content=image_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": "inline; filename=random_character.png",
                "X-Character-Data": _json.dumps(char_data),
            },
        )
    except Exception as e:
        raise HTTPException(500, f"Error generating random sprite: {e}")


# ---------------------------------------------------------------------------
# Endpoints – Test / Viewer page
# ---------------------------------------------------------------------------

@app.get("/test-characters", response_class=HTMLResponse, tags=["Testing"])
async def test_characters_page():
    """
    Interactive HTML page for generating and viewing random characters.

    Click the button to generate random characters and see their spritesheets
    along with the full selection data. Useful for testing and exploring
    the character generator.
    """
    return _TEST_PAGE_HTML


# ---------------------------------------------------------------------------
# Endpoints – Available assets (legacy)
# ---------------------------------------------------------------------------

@app.get("/available-assets", tags=["Legacy"])
async def get_available_assets():
    """Legacy endpoint – returns a curated list of known-working asset combinations."""
    from assets_endpoint import get_safe_random_assets
    try:
        return JSONResponse(content=get_safe_random_assets())
    except Exception as e:
        raise HTTPException(500, f"Error fetching assets: {e}")


# ---------------------------------------------------------------------------
# Test page HTML
# ---------------------------------------------------------------------------

_TEST_PAGE_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Alkema – Random Character Tester</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; min-height: 100vh; }
  .header { background: #16213e; padding: 20px 30px; border-bottom: 2px solid #0f3460; }
  .header h1 { font-size: 1.6em; color: #e94560; }
  .header p { color: #999; margin-top: 4px; }
  .controls { padding: 20px 30px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  select, button { padding: 10px 20px; border-radius: 6px; border: 1px solid #0f3460; font-size: 14px; }
  select { background: #16213e; color: #e0e0e0; }
  select:disabled { opacity: 0.4; cursor: not-allowed; }
  button { background: #e94560; color: white; border: none; cursor: pointer; font-weight: 600; }
  button:hover { background: #c73a52; }
  button:disabled { background: #555; cursor: wait; }
  .btn-secondary { background: #0f3460; }
  .btn-secondary:hover { background: #1a4a8a; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 20px; padding: 20px 30px; }
  .card { background: #16213e; border-radius: 10px; overflow: hidden; border: 1px solid #0f3460; }
  .card-header { padding: 12px 16px; background: #0f3460; display: flex; justify-content: space-between; align-items: center; }
  .card-header h3 { font-size: 0.95em; }
  .card-body { padding: 16px; display: flex; gap: 16px; }
  .sprite-col { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }
  .sprite-preview { width: 192px; height: 192px; background: #111; border-radius: 6px; overflow: hidden;
      image-rendering: pixelated; position: relative; }
  .sprite-preview canvas { position: absolute; top: 0; left: 0; width: 192px; height: 192px; image-rendering: pixelated; }
  .anim-controls { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
  .anim-btn { width: 28px; height: 28px; padding: 0; border-radius: 50%; background: #0f3460;
      color: #e0e0e0; font-size: 16px; display: flex; align-items: center; justify-content: center;
      cursor: pointer; border: 1px solid #1a4a8a; line-height: 1; }
  .anim-btn:hover { background: #1a4a8a; }
  .anim-label { font-size: 0.75em; color: #4ecca3; min-width: 100px; text-align: center; transition: color 0.2s; }
  .anim-label.na { color: #e94560; }
  .anim-label.weapon-miss { color: #e9a045; }
  .oversized-btn { background: #e9a045 !important; color: #1a1a2e !important; font-weight: 700; }
  .oversized-btn:hover { background: #d4903a !important; }
  .anim-badge { font-size: 0.7em; color: #4ecca3; margin-left: 8px; }
  .anim-badge.limited { color: #e9a045; }
  .sprite-container { background: #111; border-radius: 6px; overflow: hidden; image-rendering: pixelated; }
  .sprite-container img { display: block; }
  .selections { flex: 1; font-size: 0.82em; max-height: 300px; overflow-y: auto; }
  .sel-item { padding: 4px 8px; margin: 2px 0; background: #1a1a2e; border-radius: 4px; display: flex; justify-content: space-between; }
  .sel-type { color: #e94560; font-weight: 600; text-transform: uppercase; font-size: 0.8em; }
  .sel-variant { color: #4ecca3; }
  .counter { color: #4ecca3; font-size: 0.9em; }
</style>
</head>
<body>

<div class="header">
  <h1>Alkema – Random Character Tester</h1>
  <p>Generate random LPC characters and view their spritesheets</p>
</div>

<div class="controls">
  <select id="raceSelect">
    <option value="">Any Race</option>
  </select>
  <select id="bodySelect">
    <option value="">Any Body Type</option>
  </select>
  <select id="ageSelect">
    <option value="">Any Age</option>
    <option value="child">Child</option>
    <option value="teen">Teen</option>
    <option value="adult" selected>Adult</option>
    <option value="elderly">Elderly</option>
  </select>
  <select id="classSelect">
    <option value="">Any Class</option>
  </select>
  <button id="btnGenerate" onclick="generateOne()">Generate Character</button>
  <button id="btnBatch" class="btn-secondary" onclick="generateBatch()">Generate 6</button>
  <button class="btn-secondary" onclick="clearAll()">Clear All</button>
  <span class="counter" id="counter"></span>
</div>

<div class="grid" id="grid"></div>

<script>
const API = window.location.origin;
let charCount = 0;

/* ── Animation layout matching sprite_generator.py ──
   Each entry: [name, startRow, numDirections, numFrames]
   For 4-direction anims the "down" row is startRow + 2.
   For 1-direction anims the row is just startRow. */
const ANIMATIONS = [
  ['Spellcast',   0, 4, 7],
  ['Thrust',      4, 4, 8],
  ['Walk',        8, 4, 9],
  ['Slash',      12, 4, 6],
  ['Shoot',      16, 4, 13],
  ['Hurt',       20, 1, 6],
  ['Climb',      21, 1, 6],
  ['Idle',       22, 4, 2],
  ['Jump',       26, 4, 6],
  ['Sit',        30, 4, 3],
  ['Emote',      34, 4, 3],
  ['Run',        38, 4, 8],
  ['Combat Idle',42, 4, 2],
  ['Backslash',  46, 4, 13],
  ['Halfslash',  50, 3, 6],
];
const DEFAULT_ANIM = 2; // Walk

// Track per-card animation state so we can switch anims
const cardAnims = {};

// Load presets and populate Race + Body Type dropdowns
let allPresets = [];
fetch(API + '/presets').then(r => r.json()).then(data => {
  allPresets = data;
  const raceSel = document.getElementById('raceSelect');
  const bodySel = document.getElementById('bodySelect');

  // Unique races sorted
  const races = [...new Set(data.map(p => p.race))].sort();
  races.forEach(race => {
    const opt = document.createElement('option');
    opt.value = race;
    opt.textContent = race.charAt(0).toUpperCase() + race.slice(1);
    raceSel.appendChild(opt);
  });

  // Unique body types sorted sensibly (teen + child handled by Age dropdown)
  const btOrder = ['male','female','muscular','pregnant'];
  const bodyTypes = [...new Set(data.map(p => p.body_type))].filter(bt => bt !== 'teen' && bt !== 'child');
  bodyTypes.sort((a,b) => btOrder.indexOf(a) - btOrder.indexOf(b));
  bodyTypes.forEach(bt => {
    const opt = document.createElement('option');
    opt.value = bt;
    opt.textContent = bt.charAt(0).toUpperCase() + bt.slice(1);
    bodySel.appendChild(opt);
  });

  // When race changes, filter body types to only valid combos
  raceSel.addEventListener('change', () => {
    const race = raceSel.value;
    const validBts = race
      ? [...new Set(data.filter(p => p.race === race).map(p => p.body_type))].filter(bt => bt !== 'teen' && bt !== 'child')
      : bodyTypes;
    // Update body select
    const curBt = bodySel.value;
    bodySel.innerHTML = '<option value="">Any Body Type</option>';
    const sorted = validBts.sort((a,b) => btOrder.indexOf(a) - btOrder.indexOf(b));
    sorted.forEach(bt => {
      const opt = document.createElement('option');
      opt.value = bt;
      opt.textContent = bt.charAt(0).toUpperCase() + bt.slice(1);
      bodySel.appendChild(opt);
    });
    // Restore selection if still valid
    if (validBts.includes(curBt)) bodySel.value = curBt;

    // Age dropdown only applies to human
    const ageSel = document.getElementById('ageSelect');
    if (race && race !== 'human') {
      ageSel.value = 'adult';
      ageSel.disabled = true;
      ageSel.title = 'Age options are only available for Human';
    } else {
      ageSel.disabled = false;
      ageSel.title = '';
    }
  });
});

// Load classes and populate dropdown
fetch(API + '/classes').then(r => r.json()).then(classes => {
  const classSel = document.getElementById('classSelect');
  classes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.display_name;
    classSel.appendChild(opt);
  });
});

function setLoading(loading) {
  document.getElementById('btnGenerate').disabled = loading;
  document.getElementById('btnBatch').disabled = loading;
}

async function generateOne() {
  setLoading(true);
  try {
    const race = document.getElementById('raceSelect').value;
    const bt = document.getElementById('bodySelect').value;
    const age = document.getElementById('ageSelect').value;
    const cls = document.getElementById('classSelect').value;
    // Pass race + body_type individually so the age param can override body to teen
    const params = new URLSearchParams();
    if (race) params.set('race', race);
    if (bt) params.set('body_type', bt);
    if (age) params.set('age', age);
    if (cls) params.set('class', cls);
    const qs = params.toString();
    const url = API + '/random-character' + (qs ? '?' + qs : '');
    const charResp = await fetch(url);
    const charData = await charResp.json();

    const spriteResp = await fetch(API + '/generate-sprite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(charData),
    });
    const blob = await spriteResp.blob();
    const imgUrl = URL.createObjectURL(blob);

    let spriteMeta = {};
    const metaHeader = spriteResp.headers.get('X-Sprite-Meta');
    if (metaHeader) {
      try { spriteMeta = JSON.parse(metaHeader); } catch(e) {}
    }

    // Fetch supported animations in parallel with card creation
    const animResp = await fetch(API + '/supported-animations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(charData),
    });
    const animData = await animResp.json();

    addCard(charData, imgUrl, animData, spriteMeta);
  } catch (e) {
    console.error(e);
    alert('Error generating character: ' + e.message);
  } finally {
    setLoading(false);
  }
}

async function generateBatch() {
  setLoading(true);
  for (let i = 0; i < 6; i++) {
    try { await generateOne(); } catch(e) { console.error(e); }
  }
  setLoading(false);
}

function addCard(charData, imgUrl, animData, spriteMeta) {
  charCount++;
  const id = charCount;
  document.getElementById('counter').textContent = id + ' characters generated';

  // Build sets for animation status
  const supportedSet = new Set((animData && animData.supported) || []);
  const naSet = new Set((animData && animData.na) || []);
  const weaponMissing = (animData && animData.weapon_missing) || {};
  const supportedCount = supportedSet.size;

  const coverage = (animData && animData.animation_coverage) || {};
  const customAnims = (spriteMeta && spriteMeta.custom_animations) || {};

  // Build list of oversized animations available for this character
  const oversizedAnims = [];
  for (const [stdName, cov] of Object.entries(coverage)) {
    if (cov.oversized && customAnims[cov.oversized]) {
      oversizedAnims.push({
        name: cov.oversized,
        displayName: cov.oversized.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        standardName: stdName,
        ...customAnims[cov.oversized],
      });
    }
  }

  // Init animation state for this card
  cardAnims[id] = {
    animIdx: DEFAULT_ANIM, intervalId: null, sheet: null,
    supported: supportedSet, na: naSet, weaponMissing: weaponMissing,
    coverage: coverage,
    customAnims: customAnims,
    oversizedAnims: oversizedAnims,
    oversizedIdx: -1,
    showingOversized: false,
  };

  const card = document.createElement('div');
  card.className = 'card';

  const selectionsHtml = charData.selections.map(s =>
    `<div class="sel-item">
      <span><span class="sel-type">${s.type}</span> ${s.item.replace(/_/g, ' ')}</span>
      ${s.variant ? '<span class="sel-variant">' + s.variant + '</span>' : ''}
    </div>`
  ).join('');

  const oversizedBtns = oversizedAnims.length > 0
    ? `<div class="anim-controls" style="margin-top:4px">
         <div class="anim-btn oversized-btn" onclick="toggleOversized(${id})" title="Toggle oversized animations" style="width:auto;padding:0 8px;border-radius:4px;font-size:0.7em">OS</div>
         <span class="anim-label" id="os-label-${id}" style="font-size:0.65em;color:#888">${oversizedAnims.length} oversized</span>
       </div>`
    : '';

  card.innerHTML = `
    <div class="card-header">
      <h3>${(charData.race||'').charAt(0).toUpperCase()+(charData.race||'').slice(1)} ${charData.body_type.charAt(0).toUpperCase() + charData.body_type.slice(1)}${charData.character_class ? ' <span style="color:#4ecca3">'+charData.character_class.charAt(0).toUpperCase()+charData.character_class.slice(1)+'</span>' : ''}</h3>
      <span style="font-size:0.8em;color:#999">#${id} <span class="anim-badge${supportedCount < 15 ? ' limited' : ''}">${supportedCount}/15 anims</span></span>
    </div>
    <div class="card-body">
      <div class="sprite-col">
        <div class="sprite-preview">
          <canvas id="anim-${id}" width="192" height="192"></canvas>
        </div>
        <div class="anim-controls">
          <div class="anim-btn" onclick="changeAnim(${id},-1)">&#9664;</div>
          <span class="anim-label" id="anim-label-${id}">${ANIMATIONS[DEFAULT_ANIM][0]}</span>
          <div class="anim-btn" onclick="changeAnim(${id},1)">&#9654;</div>
        </div>
        ${oversizedBtns}
        <details style="margin-top:10px">
          <summary style="cursor:pointer;font-size:0.8em;color:#4ecca3">Full sheet</summary>
          <div class="sprite-container" style="margin-top:6px">
            <img src="${imgUrl}" style="width:208px" />
          </div>
        </details>
      </div>
      <div class="selections">${selectionsHtml}</div>
    </div>
  `;

  document.getElementById('grid').prepend(card);

  // Load spritesheet image and start animation
  const img = new Image();
  img.onload = () => {
    cardAnims[id].sheet = img;
    // Apply initial animation status
    const status = getAnimStatus(id, DEFAULT_ANIM);
    const label = document.getElementById('anim-label-' + id);
    if (label) {
      const suffix = status === 'na' ? ' (N/A)' : status === 'weapon-miss' ? ' (no weapon)' : '';
      label.textContent = ANIMATIONS[DEFAULT_ANIM][0] + suffix;
      label.className = 'anim-label' + (status === 'na' ? ' na' : status === 'weapon-miss' ? ' weapon-miss' : '');
    }
    startAnim(id);
  };
  img.src = imgUrl;
}

function startAnim(id) {
  const state = cardAnims[id];
  if (!state || !state.sheet) return;
  if (state.intervalId) clearInterval(state.intervalId);

  const canvas = document.getElementById('anim-' + id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (state.showingOversized && state.oversizedIdx >= 0) {
    const os = state.oversizedAnims[state.oversizedIdx];
    const fs = os.frame_size;
    const yOff = os.y_offset;
    const numFrames = os.num_frames;
    // Show south-facing direction (index 2) scaled to fill canvas
    const dir = 2;

    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, 192, 192);
      const sx = frame * fs;
      const sy = yOff + dir * fs;
      ctx.drawImage(state.sheet, sx, sy, fs, fs, 0, 0, 192, 192);
      frame = (frame + 1) % numFrames;
    }
    draw();
    state.intervalId = setInterval(draw, 150);
  } else {
    const [name, startRow, numDirs, numFrames] = ANIMATIONS[state.animIdx];
    const dirGrid = numDirs >= 4
      ? [{r: startRow,     x: 32,  y: 32},
         {r: startRow + 3, x: 96, y: 32},
         {r: startRow + 1, x: 32,  y: 96},
         {r: startRow + 2, x: 96, y: 96}]
      : [{r: startRow, x: 64, y: 64}];

    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, 192, 192);
      for (const d of dirGrid) {
        ctx.drawImage(state.sheet, frame * 64, d.r * 64, 64, 64, d.x, d.y, 64, 64);
      }
      frame = (frame + 1) % numFrames;
    }
    draw();
    state.intervalId = setInterval(draw, 150);
  }
}

function getAnimStatus(id, animIdx) {
  // Returns 'ok', 'weapon-miss', or 'na'
  const state = cardAnims[id];
  if (!state || state.supported.size === 0) return 'ok';
  const diskName = ANIMATIONS[animIdx][0].toLowerCase().replace(/ /g, '_');
  if (state.na.has(diskName)) return 'na';
  if (state.weaponMissing[diskName]) return 'weapon-miss';
  return 'ok';
}

function changeAnim(id, delta) {
  const state = cardAnims[id];
  if (!state) return;

  if (state.showingOversized) {
    state.oversizedIdx = (state.oversizedIdx + delta + state.oversizedAnims.length) % state.oversizedAnims.length;
  } else {
    state.animIdx = (state.animIdx + delta + ANIMATIONS.length) % ANIMATIONS.length;
  }

  updateAnimLabel(id);
  startAnim(id);
}

function toggleOversized(id) {
  const state = cardAnims[id];
  if (!state || state.oversizedAnims.length === 0) return;

  state.showingOversized = !state.showingOversized;
  if (state.showingOversized) {
    state.oversizedIdx = 0;
  } else {
    state.oversizedIdx = -1;
  }

  updateAnimLabel(id);
  startAnim(id);
}

function updateAnimLabel(id) {
  const state = cardAnims[id];
  const label = document.getElementById('anim-label-' + id);
  const osLabel = document.getElementById('os-label-' + id);
  if (!state || !label) return;

  if (state.showingOversized && state.oversizedIdx >= 0) {
    const os = state.oversizedAnims[state.oversizedIdx];
    label.textContent = os.displayName;
    label.className = 'anim-label';
    label.style.color = '#e9a045';
    if (osLabel) osLabel.textContent = (state.oversizedIdx + 1) + '/' + state.oversizedAnims.length + ' oversized';
  } else {
    const status = getAnimStatus(id, state.animIdx);
    const suffix = status === 'na' ? ' (N/A)' : status === 'weapon-miss' ? ' (no weapon)' : '';
    label.textContent = ANIMATIONS[state.animIdx][0] + suffix;
    label.className = 'anim-label' + (status === 'na' ? ' na' : status === 'weapon-miss' ? ' weapon-miss' : '');
    label.style.color = '';
    if (osLabel) osLabel.textContent = state.oversizedAnims.length + ' oversized';
  }
}

function clearAll() {
  // Clean up intervals
  for (const id in cardAnims) {
    if (cardAnims[id].intervalId) clearInterval(cardAnims[id].intervalId);
  }
  Object.keys(cardAnims).forEach(k => delete cardAnims[k]);
  document.getElementById('grid').innerHTML = '';
  charCount = 0;
  document.getElementById('counter').textContent = '';
}
</script>
</body>
</html>"""


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

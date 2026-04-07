# Alkema

Alkema is a character sprite generator and multiplayer game built on [Liberated Pixel Cup](https://lpc.opengameart.org) assets. It provides a REST API for generating fully animated character spritesheets, a browser-based character tester, and a real-time multiplayer game client.

## What's Working

### Character Sprite API

A FastAPI service that composes LPC sprite layers into complete character spritesheets.

- **657 items** across 104 categories (weapons, armor, hair, wings, tails, etc.)
- **36 weapons** with per-animation visibility metadata
- **15 animations** per spritesheet (walk, slash, thrust, spellcast, idle, run, and more)
- **8 body types** (male, female, muscular, teen, child, pregnant, skeleton, zombie)
- **30 playable races** including human, elf, orc, fey (pixie/sylph/dark), furry (cat/fox/wolf/bunny), dragonblood, angel, demon, and more
- **10 character classes** (warrior, mage, pirate, ranger, thief, cleric, noble, guard, merchant, peasant)
- **10 color palettes** that coordinate outfit colors across all equipped items
- Tag-based item compatibility system ensures valid combinations
- Race-specific rules: forced items, palette restrictions, skip categories
- Cosmetic extras: facial hair (beard/mustache), hair extensions, pirate prosthetics

### Demo Page

An interactive browser-based character tester at `/test-characters`. Generate random characters filtered by race, body type, age, class, and armor weight. View the full spritesheet, cycle through animations, preview oversized weapon attacks, and inspect all selection metadata.

### Game Client

A Phaser 3 multiplayer browser game with real-time movement and character rendering.

- WebSocket-based multiplayer via Socket.io
- Dynamic sprite loading from the API
- Mobile-responsive portrait layout
- Player movement with animated walk/idle cycles
- Camera follows local player across a tile map

## API Endpoints

### Sprite Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/generate-sprite` | Generate a character spritesheet PNG from a list of items |
| `GET` | `/random-character` | Generate a random valid character with race/class/armor rules |
| `GET` | `/random-character/sprite` | Get a random character as a PNG image directly |

### Item Database

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/items` | Search all items with optional filters |
| `GET` | `/items/{category}` | Get all items in a category |
| `GET` | `/item/{file_name}` | Get full details for a specific item |
| `POST` | `/available-options` | Get items compatible with current selections |
| `POST` | `/supported-animations` | Check which animations a character supports |

### Reference Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/body-types` | List available body types |
| `GET` | `/categories` | List all item categories |
| `GET` | `/tags` | List all tags |
| `GET` | `/animations` | List animation definitions |
| `GET` | `/presets` | List race/body preset combinations |
| `GET` | `/classes` | List character classes with equipment rules |
| `GET` | `/rules` | Auto-generated documentation of all generation rules |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/stats` | Database statistics |
| `GET` | `/docs` | Interactive Swagger UI |

## API Examples

### Generate a Random Character

```bash
curl http://localhost:8000/random-character
```

Response includes race, class, palette, and all selected items with variants:

```json
{
  "body_type": "female",
  "race": "fey-pixie",
  "character_class": "ranger",
  "armor": "light",
  "color_palette": "rose",
  "selections": [
    {"type": "body", "item": "body", "variant": "lavender"},
    {"type": "head", "item": "heads_human_female", "variant": "lavender"},
    {"type": "ears", "item": "head_ears_down", "variant": "lavender"},
    {"type": "wings", "item": "wings_monarch", "variant": "rose"},
    {"type": "hair", "item": "hair_braid", "variant": "gold"},
    {"type": "weapon", "item": "weapon_ranged_bow_normal", "variant": "oak"}
  ],
  "description": "Fey-Pixie Ranger female character..."
}
```

### Filter Random Characters

```bash
# Human male warrior in heavy armor
curl "http://localhost:8000/random-character?race=human&body_type=male&class=warrior&armor=heavy"

# Any fey-dark character
curl "http://localhost:8000/random-character?race=fey-dark"

# Random sprite as PNG
curl "http://localhost:8000/random-character/sprite" --output character.png
```

### Generate a Specific Character

```bash
curl -X POST "http://localhost:8000/generate-sprite" \
  -H "Content-Type: application/json" \
  -d '{
    "body_type": "male",
    "items": [
      {"type": "body", "item": "body", "variant": "light"},
      {"type": "head", "item": "heads_human_male", "variant": "light"},
      {"type": "hair", "item": "hair_plain", "variant": "blonde"},
      {"type": "clothes", "item": "torso_clothes_longsleeve", "variant": "white"},
      {"type": "legs", "item": "legs_pants", "variant": "teal"},
      {"type": "weapon", "item": "weapon_sword_longsword", "variant": null}
    ]
  }' --output knight.png
```

### Browse Available Items

```bash
# List all weapon items
curl http://localhost:8000/items/weapon

# Get details for a specific item
curl http://localhost:8000/item/weapon_sword_longsword

# See what's compatible with current selections
curl -X POST "http://localhost:8000/available-options" \
  -H "Content-Type: application/json" \
  -d '{"body_type": "male", "current_selections": [
    {"type": "body", "item": "body", "variant": "light"}
  ]}'
```

## Spritesheet Format

Generated spritesheets are **832 x 3392 pixels** (13 columns x 53 rows of 64x64 frames).

| Animation | Rows | Directions | Frames |
|-----------|------|------------|--------|
| Spellcast | 0-3 | N/W/S/E | 7 |
| Thrust | 4-7 | N/W/S/E | 8 |
| Walk | 8-11 | N/W/S/E | 9 |
| Slash | 12-15 | N/W/S/E | 6 |
| Shoot | 16-19 | N/W/S/E | 13 |
| Hurt | 20 | 1 | 6 |
| Climb | 21 | 1 | 6 |
| Idle | 22-25 | N/W/S/E | 2 |
| Jump | 26-29 | N/W/S/E | 4 |
| Sit | 30-33 | N/W/S/E | 4 |
| Emote | 34-37 | N/W/S/E | 4 |
| Run | 38-41 | N/W/S/E | 4 |
| Combat Idle | 42-45 | N/W/S/E | 4 |
| Backslash | 46-49 | N/W/S/E | 4 |
| Halfslash | 50-52 | N/W/S | 3 |

Some weapons include **oversized animations** (128x128 or 192x192 frames) appended below the standard rows for larger attack sprites.

## Character Generation Rules

The `/rules` endpoint returns the complete, auto-generated rule set. Key concepts:

- **Races** define forced items (elf ears, demon wings, furry tails), allowed skin colors, and palette restrictions
- **Classes** define preferred weapons, shields, headgear, and always/never equipment rules
- **Armor weights** (heavy/normal/light/formal/topless/nude) control available clothing and accessories
- **Color palettes** coordinate fabrics, accents, and metals across all equipped items
- **Priority**: race skips > armor weight > class preferences > defaults

## Tech Stack

- **FastAPI** + **Pillow** - Sprite composition API
- **PostgreSQL** + **SQLAlchemy** - Item database with tag/layer relationships
- **MongoDB** - Game state persistence
- **Phaser 3** - Browser game engine
- **Socket.io** - Real-time multiplayer
- **Docker Compose** - Container orchestration
- **Vite** - Game client build tool

## Credits

Built on assets from the [Liberated Pixel Cup](https://lpc.opengameart.org) and the [Universal LPC Spritesheet Character Generator](https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator). All LPC assets require attribution under CC-BY-SA, CC-BY, CC0, OGA-BY, or GPL licenses. See CREDITS.csv for detailed attribution.

## License

See [LICENSE](LICENSE) for details.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alkema is a browser game featuring LPC (Liberated Pixel Cup) character customization. The project consists of:
1. A FastAPI backend service for generating character sprites via direct image composition (Pillow)
2. A Phaser 3 multiplayer game client with Socket.io
3. A Node.js game server
4. The Universal LPC Spritesheet Character Generator (legacy HTML5 frontend, used for sprite assets)

## Development Commands

### Starting the Development Environment
```bash
# Windows
BuildScript.bat

# Or using Docker Compose directly
docker compose down
docker compose build
docker compose up
```

### Services and Ports
- **API Service**: http://localhost:8000 - FastAPI backend
- **API Documentation**: http://localhost:8000/docs - Swagger UI
- **Game Client**: http://localhost:3000 - Phaser 3 game
- **Game Server**: http://localhost:3001 - Socket.io server
- **Legacy Generator**: http://localhost:8080 - Static HTML5 sprite generator
- **Test Page**: http://localhost:8000/test-characters - Interactive character tester

## Architecture

### Project Structure
- `/API-Character-Sprite-Generator/` - FastAPI backend service
  - `main_v2.py` - Main application with all config dicts, API endpoints, character generation
  - `sprite_generator.py` - Sprite rendering engine (Pillow-based layer compositing)
  - `models.py` - SQLAlchemy database models (PostgreSQL)
  - `mongodb_models.py` - MongoDB models for game state
  - `ingest_lpc_data.py` - Database population from JSON definitions
  - `animation_scanner.py` - Filesystem scanner for animation availability

- `/Alkema-Client/` - Game client and server
  - `client/` - Phaser 3 browser game (Vite build)
  - `server/` - Node.js Express + Socket.io server

- `/Universal-LPC-Spritesheet-Character-Generator/` - Legacy sprite assets
  - `spritesheets/` - All LPC sprite image files
  - `sheet_definitions/` - JSON metadata for each item

### Character Generation Architecture
All character generation rules are data-driven via config dicts in `main_v2.py`:
- **RACE_HEAD_CONFIG** - head items per race/body type
- **RACE_SKIN_COLORS** - skin color variants per race
- **RACE_FORCED_ITEMS** - auto-added items per race (ears, wings, tails)
- **RACE_SKIP_CATEGORIES** - categories excluded per race
- **RACE_PALETTES** - palette restrictions per race
- **CHARACTER_CLASSES** - per-class equipment preferences
- **ARMOR_WEIGHTS** - per-tier clothing restrictions
- **COLOR_PALETTES** - named palettes with fabrics/accents/metals

The `GET /rules` endpoint auto-generates documentation from these dicts. Never maintain separate rule docs.

Priority order when rules conflict: race skips > armor weight > class preferences > defaults.

### Docker Architecture
- `postgres` - PostgreSQL 16 for item database
- `mongodb` - MongoDB 7.0 for game state
- `legacy-generator` - nginx serving sprite assets
- `api-character-sprite-generator` - FastAPI sprite service
- `game-server` - Node.js Socket.io server
- `game-client` - Vite dev server for Phaser 3 client

## Public README Auto-Update

**IMPORTANT**: When committing changes that add, remove, or modify features, update `public/README.md` to reflect only what is currently working. This file is synced to the public GitHub repo.

Rules for updating `public/README.md`:
- Only describe features that are implemented and working
- Do not mention planned features, roadmaps, or future work
- Update API endpoint tables if endpoints are added/removed
- Update the "What's Working" section if capabilities change
- Update race/class/item counts if they change
- Keep examples accurate (test them if unsure)
- Do not expose server-side implementation details, file paths, or database schemas

## LPC Asset Licensing
All LPC assets require attribution. Assets are licensed under CC-BY-SA, CC-BY, CC0, OGA-BY, or GPL licenses. See CREDITS.csv for details.

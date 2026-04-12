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
- `api-character-sprite-generator` - FastAPI sprite service (container name: `alkema-api`)
- `game-server` - Node.js Socket.io server (container name: `alkema-game-server`)
- `game-client` - nginx serving Phaser 3 client (container name: `alkema-game-client`)

## DevOps & Deployment

### Environment Architecture

Local and production use the **same code** with different Docker Compose layering:

```
docker-compose.yml            # Base config — all services, shared settings
docker-compose.override.yml   # Local dev — auto-loaded, adds ports + source volume mounts
docker-compose.prod.yml       # Production — adds caddy-net network + ROOT_PATH for API
```

**Locally:** `docker compose up -d` auto-loads `docker-compose.yml` + `docker-compose.override.yml`
**Production:** `docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d`

### What Each Override Does

**`docker-compose.override.yml` (local only, auto-loaded):**
- Exposes ports for direct access (3000, 3001, 8000, 8080, 5432, 27017)
- Mounts source code as volumes for hot reload
- NOT used in production

**`docker-compose.prod.yml` (production only):**
- Connects game-client, game-server, API, and legacy-generator to `caddy-net` external network
- Sets `ROOT_PATH=/api` on the API (Caddy's `handle_path /api/*` strips the prefix)
- No ports exposed — Caddy handles all external routing

### Production Server

- **Server:** `158.69.117.237` (z3q.com)
- **SSH:** `ssh -i "C:\Users\User\Desktop\Montreal-2022.pem" ubuntu@158.69.117.237`
- **Convenience script:** `server-run.bat` wraps the SSH command. Usage: `server-run.bat "command here"`
- **Repo on server:** `/home/ubuntu/Alkema-Backend`
- **Caddy config:** `/home/ubuntu/Wordpress-Mega-Merger/config/Caddyfile`
- **Caddy is in a separate Docker Compose stack** (`Wordpress-Mega-Merger`). It routes z3q.com traffic to Alkema containers via the shared `caddy-net` Docker network.

### Caddy Routing (z3q.com)

| Path | Destination | Container |
|------|-------------|-----------|
| `/socket.io/*` | WebSocket server | `alkema-game-server:3001` |
| `/sprites/*` | Composited sprite PNGs | `alkema-game-server:3001` |
| `/api/*` | FastAPI (prefix stripped) | `alkema-api:8000` |
| `/spritesheets/*` | Legacy sprite assets | `alkema-legacy-generator:80` |
| `/*` (default) | Game client | `alkema-game-client:3000` |

### Auto-Deploy

Push to `master` triggers GitHub Actions (`.github/workflows/deploy.yml`):
1. SSH into production server
2. `git pull origin master`
3. `docker-compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache`
4. `docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate`
5. Reload Caddy config

### Manual Production Commands

```bash
# SSH into server (from Windows)
server-run.bat "command here"

# Or directly:
ssh -i "C:\Users\User\Desktop\Montreal-2022.pem" ubuntu@158.69.117.237 "cd /home/ubuntu/Alkema-Backend && command"

# Restart a single service
server-run.bat "cd /home/ubuntu/Alkema-Backend && docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart game-server"

# View logs
server-run.bat "cd /home/ubuntu/Alkema-Backend && docker-compose logs --tail=30 game-server"

# Check container status
server-run.bat "cd /home/ubuntu/Alkema-Backend && docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps"

# Reload Caddy after config changes
server-run.bat "cd /home/ubuntu/Wordpress-Mega-Merger && docker-compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile"
```

### Common Production Issues

**502 Bad Gateway:** Containers lost `caddy-net` network connection. This happens if containers were rebuilt without using the prod overlay. Fix: redeploy with the proper `-f` flags, or manually reconnect: `docker network connect caddy-net alkema-game-client`

**Ghost players stuck on server:** In-memory player list not cleared. Fix: `docker-compose restart game-server`

**API unhealthy:** The API takes ~60s to start (database migrations + asset scanning). Wait for health check, or check logs.

### Push Protocol

Always push to both remotes:
```bash
git push origin master   # Private repo (Alkema-Backend)
git push public master   # Public repo (Alkema)
```

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

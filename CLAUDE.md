# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alkema is an open-source browser game that features LPC (Liberated Pixel Cup) character customization. The project consists of two main components:
1. A FastAPI backend service for generating character sprites
2. The Universal LPC Spritesheet Character Generator (HTML5/JavaScript frontend)

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
- **Legacy Generator (Frontend)**: http://localhost:8080 - Static HTML5 sprite generator
- **API Service**: http://localhost:8000 - FastAPI backend
- **API Documentation**: http://localhost:8000/docs - Swagger UI

## Architecture

### Project Structure
- `/API-Character-Sprite-Generator/` - FastAPI backend service
  - Uses Pyppeteer to render sprites from the legacy generator
  - Extracts available parameters from sheet definition JSON files
  - Returns PNG images of generated sprites
  
- `/Universal-LPC-Spritesheet-Character-Generator/` - Frontend character generator
  - Static HTML5/JavaScript application
  - Contains sprite sheets and JSON definitions in `/sheet_definitions/`
  - Served via nginx container

### Key API Endpoints
- `POST /generate-sprite` - Generates a sprite PNG based on parameters (body_type, head_type, hair_style, hair_color, skin_color)
- `GET /available-parameters` - Returns all available customization options by scanning sheet definition files
- `GET /test` - Health check endpoint

### Docker Architecture
The application uses Docker Compose with two services:
1. `legacy-generator`: nginx serving the HTML5 generator
2. `api-character-sprite-generator`: FastAPI service that interfaces with the generator

### Important Technical Details
- The API uses Pyppeteer (Python Puppeteer) to programmatically control a headless Chromium browser
- Sprite generation works by navigating to the legacy generator with URL parameters and extracting the rendered canvas as PNG
- Available parameters are dynamically extracted from JSON files in `/sheet_definitions/`
- The API container mounts the generator files as read-only volume at `/generator`

## LPC Asset Licensing
All LPC assets require attribution. The generator creates CREDITS.csv files with required attribution information. Assets are licensed under CC-BY-SA, CC-BY, CC0, OGA-BY, or GPL licenses.
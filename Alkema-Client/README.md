# Alkema Game Client

A multiplayer browser-based RPG with dynamic LPC character sprites.

## Architecture

### Client (Phaser 3)
- Real-time multiplayer using Socket.io
- Dynamic sprite loading from API
- Minimal file size through on-demand asset loading
- Animation detection based on character equipment

### Server (Node.js + Socket.io)
- WebSocket-based real-time communication
- MongoDB for persistent storage
- Character metadata and equipment system
- JWT-based authentication

### Key Features
- **Dynamic Sprites**: Characters are generated on-demand using the API
- **Equipment System**: Metadata-driven equipment that affects appearance
- **Animation Detection**: Automatically detects available animations based on equipment
- **Small File Size**: Assets loaded as needed, not bundled

## Development

### Prerequisites
- Node.js 20+
- Docker and Docker Compose
- MongoDB (included in Docker setup)

### Quick Start

Using the main build script:
```bash
# From project root
BuildScript.bat
```

Or manually:
```bash
# Install dependencies
cd Alkema-Client
npm run install:all

# Start development servers
npm run dev
```

### Service URLs
- **Game Client**: http://localhost:3000
- **Game Server**: http://localhost:3001
- **Sprite API**: http://localhost:8000
- **MongoDB**: mongodb://localhost:27017/alkema

## Character Metadata Structure

Characters store metadata for dynamic customization:

```javascript
{
  baseSprite: {
    body_type: "male",
    skin_color: "light",
    hair_style: "short",
    hair_color: "brown"
  },
  equipment: {
    armor: { id: "leather_armor", layer: 2 },
    weapon: { id: "iron_sword", layer: 3 }
  },
  animations: {
    available: ["idle", "walk", "attack"],
    custom: {}
  }
}
```

## API Integration

The game integrates with the existing sprite generation API:
- `POST /generate-sprite` - Generate character sprites with equipment
- `GET /available-parameters` - Get available customization options

## Animation System

Animations are detected based on:
1. Base animations (idle, walk)
2. Weapon-specific animations (attack types)
3. Available sprite sheet frames

The system automatically determines which animations are available for each character configuration.
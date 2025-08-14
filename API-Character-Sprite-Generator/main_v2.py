from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from pydantic import BaseModel
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from models import create_session, init_database
from sprite_generator import SpriteGenerator
from assets_endpoint import get_safe_random_assets
import os

# MongoDB imports
from mongodb_models import MongoDBConnection
from game_endpoints import router as game_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle - connect/disconnect databases."""
    # Startup
    print("Starting up...")
    
    # Initialize PostgreSQL for sprite data
    try:
        init_database()
        print("PostgreSQL database tables verified")
    except Exception as e:
        print(f"PostgreSQL initialization note: {e}")
    
    # Connect to MongoDB for game data
    await MongoDBConnection.connect()
    
    yield
    
    # Shutdown
    print("Shutting down...")
    await MongoDBConnection.disconnect()


app = FastAPI(title="Alkema Character API", version="3.0.0", lifespan=lifespan)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include game endpoints router
app.include_router(game_router)

def get_db():
    """Dependency to get database session."""
    db = create_session()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
async def root():
    return {
        "message": "Alkema Character API v3",
        "endpoints": {
            "sprite_generation": {
                "generate": "/generate-sprite",
                "available": "/available-options",
                "body_types": "/body-types",
                "assets": "/available-assets"
            },
            "game_data": {
                "players": "/game/players/*",
                "characters": "/game/characters/*",
                "sessions": "/game/sessions/*",
                "admin": "/game/admin/*"
            },
            "health": "/health"
        }
    }

@app.get("/health")
async def health_check():
    mongodb_status = "connected" if MongoDBConnection.client else "disconnected"
    return {
        "status": "healthy", 
        "postgresql": "connected",
        "mongodb": mongodb_status
    }

class SpriteRequest(BaseModel):
    body_type: str
    selections: List[Dict[str, str]]
    
class AvailableOptionsRequest(BaseModel):
    body_type: str
    current_selections: Optional[List[Dict[str, str]]] = []

@app.post("/generate-sprite")
async def generate_sprite(
    request: SpriteRequest,
    db: Session = Depends(get_db)
):
    """
    Generate a character sprite based on selections.
    
    Example request:
    {
        "body_type": "male",
        "selections": [
            {"type": "body", "item": "body", "variant": "light"},
            {"type": "head", "item": "heads_human_male"},
            {"type": "hair", "item": "hair_long", "variant": "blonde"},
            {"type": "legs", "item": "legs_pants", "variant": "teal"},
            {"type": "torso", "item": "torso_shirt", "variant": "white"}
        ]
    }
    """
    try:
        generator = SpriteGenerator(db)
        image_bytes = generator.generate_spritesheet(
            request.body_type,
            request.selections
        )
        
        return Response(
            content=image_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": "inline; filename=character.png"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating sprite: {str(e)}")

@app.post("/available-options")
async def get_available_options(
    request: AvailableOptionsRequest,
    db: Session = Depends(get_db)
):
    """
    Get available customization options based on body type and current selections.
    
    This endpoint respects the tag-based dependency system:
    - Items with required_tags only appear if those tags are present
    - Items with excluded_tags are hidden if those tags are present
    - Only items compatible with the selected body type are returned
    """
    try:
        generator = SpriteGenerator(db)
        options = generator.get_available_options(
            request.body_type,
            request.current_selections
        )
        
        return {
            "body_type": request.body_type,
            "available_options": options,
            "total_categories": len(options)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching options: {str(e)}")

@app.get("/available-assets")
async def get_available_assets():
    """
    Get the curated list of available assets that are known to work.
    Returns safe combinations for character generation.
    """
    try:
        assets = get_safe_random_assets()
        return JSONResponse(content=assets)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching assets: {str(e)}")

@app.get("/body-types")
async def get_body_types(db: Session = Depends(get_db)):
    """Get all available body types."""
    from models import BodyType
    
    body_types = db.query(BodyType).all()
    return {
        "body_types": [
            {
                "name": bt.name,
                "display_name": bt.display_name,
                "tags": bt.tags
            }
            for bt in body_types
        ]
    }

@app.get("/categories")
async def get_categories(db: Session = Depends(get_db)):
    """Get all item categories/types."""
    from sqlalchemy import distinct
    from models import Item
    
    categories = db.query(distinct(Item.type_name)).order_by(Item.type_name).all()
    return {
        "categories": [cat[0] for cat in categories]
    }

@app.get("/items/{category}")
async def get_items_by_category(
    category: str,
    body_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get all items in a specific category, optionally filtered by body type."""
    from models import Item
    
    query = db.query(Item).filter(Item.type_name == category)
    items = query.all()
    
    if body_type:
        compatible_items = []
        for item in items:
            for layer in item.layers:
                if any(bt.body_type == body_type for bt in layer.body_types):
                    compatible_items.append(item)
                    break
        items = compatible_items
    
    return {
        "category": category,
        "body_type": body_type,
        "items": [
            {
                "name": item.name,
                "file_name": item.file_name,
                "variants": [
                    {"name": v.name, "value": v.value}
                    for v in item.variants
                ],
                "tags": [t.name for t in item.tags],
                "required_tags": [t.name for t in item.required_tags],
                "excluded_tags": [t.name for t in item.excluded_tags]
            }
            for item in items
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
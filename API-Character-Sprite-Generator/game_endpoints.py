"""FastAPI endpoints for game data management."""

from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict, Any
from datetime import datetime
from bson import ObjectId
import bcrypt
import secrets

from mongodb_models import (
    Player, Character, GameSession,
    CharacterAppearance, CharacterStats, CharacterPosition,
    MongoDBConnection, get_database,
    get_player_by_username, get_character_by_id, get_session_by_socket
)


router = APIRouter(prefix="/game", tags=["game"])


# Player Management Endpoints

@router.post("/players/register")
async def register_player(
    username: str,
    email: str,
    password: str,
    db=Depends(get_database)
):
    """Register a new player account."""
    # Check if username or email already exists
    existing = await db.players.find_one({
        "$or": [
            {"username": username},
            {"email": email}
        ]
    })
    
    if existing:
        raise HTTPException(400, "Username or email already registered")
    
    # Hash password
    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    # Create player
    player = Player(
        username=username,
        email=email,
        password_hash=password_hash
    )
    
    result = await db.players.insert_one(player.dict(by_alias=True))
    player.id = result.inserted_id
    
    return {
        "id": str(player.id),
        "username": player.username,
        "message": "Player registered successfully"
    }


@router.post("/players/login")
async def login_player(
    username: str,
    password: str,
    db=Depends(get_database)
):
    """Login a player and return their data."""
    player_data = await db.players.find_one({"username": username})
    
    if not player_data:
        raise HTTPException(401, "Invalid username or password")
    
    player = Player(**player_data)
    
    # Verify password
    if not bcrypt.checkpw(password.encode('utf-8'), player.password_hash.encode('utf-8')):
        raise HTTPException(401, "Invalid username or password")
    
    # Update last login
    await db.players.update_one(
        {"_id": player.id},
        {"$set": {"last_login": datetime.utcnow()}}
    )
    
    # Get player's characters
    characters = []
    if player.characters:
        cursor = db.characters.find({"_id": {"$in": [ObjectId(cid) for cid in player.characters]}})
        async for char_data in cursor:
            characters.append(Character(**char_data).to_game_format())
    
    return {
        "id": str(player.id),
        "username": player.username,
        "characters": characters,
        "active_character": player.active_character
    }


@router.get("/players/{player_id}")
async def get_player(player_id: str, db=Depends(get_database)):
    """Get player information by ID."""
    try:
        player_data = await db.players.find_one({"_id": ObjectId(player_id)})
        if not player_data:
            raise HTTPException(404, "Player not found")
        
        player = Player(**player_data)
        return {
            "id": str(player.id),
            "username": player.username,
            "created_at": player.created_at,
            "last_login": player.last_login,
            "character_count": len(player.characters)
        }
    except Exception as e:
        raise HTTPException(400, f"Invalid player ID: {str(e)}")


# Character Management Endpoints

@router.post("/characters/create")
async def create_character(
    name: str,
    player_id: Optional[str] = None,
    appearance: Optional[Dict[str, Any]] = None,
    db=Depends(get_database)
):
    """Create a new character."""
    # Check if name is already taken
    existing = await db.characters.find_one({"name": name})
    if existing:
        raise HTTPException(400, f"Character name '{name}' is already taken")
    
    # Create character
    character = Character(name=name, owner_id=player_id)
    
    # Apply appearance if provided
    if appearance:
        character.appearance = CharacterAppearance(**appearance)
    
    # Save character
    result = await db.characters.insert_one(character.dict(by_alias=True))
    character.id = result.inserted_id
    
    # If player_id provided, add to player's character list
    if player_id:
        await db.players.update_one(
            {"_id": ObjectId(player_id)},
            {"$push": {"characters": str(character.id)}}
        )
    
    return {
        "id": str(character.id),
        "message": f"Character '{name}' created successfully",
        "character": character.to_game_format()
    }


@router.get("/characters/{character_id}")
async def get_character(character_id: str, db=Depends(get_database)):
    """Get character by ID."""
    try:
        character = await get_character_by_id(character_id)
        if not character:
            raise HTTPException(404, "Character not found")
        
        return character.to_game_format()
    except Exception as e:
        raise HTTPException(400, f"Invalid character ID: {str(e)}")


@router.put("/characters/{character_id}/appearance")
async def update_character_appearance(
    character_id: str,
    appearance: Dict[str, Any],
    db=Depends(get_database)
):
    """Update character appearance."""
    try:
        # Validate appearance data
        appearance_obj = CharacterAppearance(**appearance)
        
        result = await db.characters.update_one(
            {"_id": ObjectId(character_id)},
            {
                "$set": {
                    "appearance": appearance_obj.dict(),
                    "last_played": datetime.utcnow()
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(404, "Character not found")
        
        # Get updated character
        character = await get_character_by_id(character_id)
        return character.to_game_format()
        
    except Exception as e:
        raise HTTPException(400, f"Error updating character: {str(e)}")


@router.put("/characters/{character_id}/position")
async def update_character_position(
    character_id: str,
    x: float,
    y: float,
    map: Optional[str] = None,
    db=Depends(get_database)
):
    """Update character position."""
    try:
        update_data = {
            "position.x": x,
            "position.y": y,
            "last_played": datetime.utcnow()
        }
        
        if map:
            update_data["position.map"] = map
        
        result = await db.characters.update_one(
            {"_id": ObjectId(character_id)},
            {"$set": update_data}
        )
        
        if result.matched_count == 0:
            raise HTTPException(404, "Character not found")
        
        return {"message": "Position updated"}
        
    except Exception as e:
        raise HTTPException(400, f"Error updating position: {str(e)}")


# Session Management Endpoints

@router.post("/sessions/create")
async def create_session(
    socket_id: str,
    player_id: Optional[str] = None,
    character_id: Optional[str] = None,
    db=Depends(get_database)
):
    """Create a new game session."""
    # Remove any existing session with this socket_id
    await db.sessions.delete_one({"socket_id": socket_id})
    
    session = GameSession(
        socket_id=socket_id,
        player_id=player_id,
        character_id=character_id,
        is_guest=(player_id is None)
    )
    
    # If character_id provided, load character data
    if character_id:
        character = await get_character_by_id(character_id)
        if character:
            session.character_data = character.to_game_format()
            session.room = character.position.map
    
    result = await db.sessions.insert_one(session.dict(by_alias=True))
    session.id = result.inserted_id
    
    return {
        "session_id": str(session.id),
        "socket_id": socket_id,
        "is_guest": session.is_guest,
        "character_data": session.character_data
    }


@router.post("/sessions/create-guest")
async def create_guest_session(
    socket_id: str,
    character_data: Dict[str, Any],
    db=Depends(get_database)
):
    """Create a guest session with temporary character data."""
    # Remove any existing session with this socket_id
    await db.sessions.delete_one({"socket_id": socket_id})
    
    session = GameSession(
        socket_id=socket_id,
        character_data=character_data,
        is_guest=True
    )
    
    result = await db.sessions.insert_one(session.dict(by_alias=True))
    session.id = result.inserted_id
    
    return {
        "session_id": str(session.id),
        "socket_id": socket_id,
        "character_data": character_data
    }


@router.get("/sessions/{socket_id}")
async def get_session(socket_id: str, db=Depends(get_database)):
    """Get session by socket ID."""
    session = await get_session_by_socket(socket_id)
    
    if not session:
        raise HTTPException(404, "Session not found")
    
    return {
        "session_id": str(session.id),
        "socket_id": session.socket_id,
        "player_id": session.player_id,
        "character_id": session.character_id,
        "character_data": session.character_data,
        "room": session.room,
        "is_guest": session.is_guest
    }


@router.delete("/sessions/{socket_id}")
async def delete_session(socket_id: str, db=Depends(get_database)):
    """Delete a session (player disconnected)."""
    result = await db.sessions.delete_one({"socket_id": socket_id})
    
    if result.deleted_count == 0:
        raise HTTPException(404, "Session not found")
    
    return {"message": "Session deleted"}


@router.put("/sessions/{socket_id}/activity")
async def update_session_activity(socket_id: str, db=Depends(get_database)):
    """Update session last activity timestamp."""
    result = await db.sessions.update_one(
        {"socket_id": socket_id},
        {"$set": {"last_activity": datetime.utcnow()}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(404, "Session not found")
    
    return {"message": "Activity updated"}


# Admin/Debug Endpoints

@router.get("/admin/stats")
async def get_game_stats(db=Depends(get_database)):
    """Get game statistics."""
    player_count = await db.players.count_documents({})
    character_count = await db.characters.count_documents({})
    session_count = await db.sessions.count_documents({})
    
    # Get active sessions (last activity within 5 minutes)
    from datetime import timedelta
    cutoff_time = datetime.utcnow() - timedelta(minutes=5)
    active_sessions = await db.sessions.count_documents({
        "last_activity": {"$gte": cutoff_time}
    })
    
    return {
        "total_players": player_count,
        "total_characters": character_count,
        "total_sessions": session_count,
        "active_sessions": active_sessions
    }



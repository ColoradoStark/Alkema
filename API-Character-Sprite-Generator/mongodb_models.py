"""MongoDB models and connection for game data persistence."""

from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import core_schema
from typing import Optional, List, Dict, Any, Annotated
from typing_extensions import Annotated
from datetime import datetime
from bson import ObjectId
import os


class PyObjectId(str):
    """Custom ObjectId type for Pydantic v2 models."""
    @classmethod
    def __get_pydantic_core_schema__(
        cls,
        _source_type: Any,
        _handler: Any,
    ) -> core_schema.CoreSchema:
        return core_schema.json_or_python_schema(
            json_schema=core_schema.str_schema(),
            python_schema=core_schema.union_schema([
                core_schema.is_instance_schema(ObjectId),
                core_schema.chain_schema([
                    core_schema.str_schema(),
                    core_schema.no_info_plain_validator_function(cls.validate),
                ])
            ]),
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda x: str(x),
                return_schema=core_schema.str_schema(),
            ),
        )
    
    @classmethod
    def validate(cls, value) -> ObjectId:
        if isinstance(value, ObjectId):
            return value
        if ObjectId.is_valid(value):
            return ObjectId(value)
        raise ValueError("Invalid ObjectId")


class MongoBase(BaseModel):
    """Base model with MongoDB ID handling."""
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str}
    )
    
    id: Optional[Annotated[ObjectId, PyObjectId]] = Field(default=None, alias="_id")


class CharacterAppearance(BaseModel):
    """Character visual appearance data."""
    body_type: str = "male"
    skin_color: str = "light"
    hair_style: str = "plain"
    hair_color: str = "brown"
    shirt_type: str = "vest"
    shirt_color: str = "white"
    pants_color: str = "brown"


class CharacterStats(BaseModel):
    """Character gameplay statistics."""
    health: int = 100
    max_health: int = 100
    mana: int = 50
    max_mana: int = 50
    attack: int = 10
    defense: int = 5
    speed: int = 5


class CharacterPosition(BaseModel):
    """Character position in game world."""
    x: float = 512
    y: float = 384
    map: str = "spawn"


class Character(MongoBase):
    """Character model for MongoDB."""
    name: str
    owner_id: Optional[str] = None  # Player ID who owns this character
    level: int = 1
    experience: int = 0
    appearance: CharacterAppearance = Field(default_factory=CharacterAppearance)
    stats: CharacterStats = Field(default_factory=CharacterStats)
    position: CharacterPosition = Field(default_factory=CharacterPosition)
    equipment: Dict[str, Any] = Field(default_factory=dict)
    inventory: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_played: datetime = Field(default_factory=datetime.utcnow)
    
    def to_game_format(self) -> dict:
        """Convert to format expected by game client."""
        return {
            "id": str(self.id),
            "name": self.name,
            "body_type": self.appearance.body_type,
            "skin_color": self.appearance.skin_color,
            "hair_style": self.appearance.hair_style,
            "hair_color": self.appearance.hair_color,
            "shirt_type": self.appearance.shirt_type,
            "shirt_color": self.appearance.shirt_color,
            "pants_color": self.appearance.pants_color,
            "equipment": self.equipment,
            "animations": {
                "available": ["idle", "walk", "attack", "hurt"],
                "custom": {}
            },
            "lastUpdated": int(self.last_played.timestamp() * 1000)
        }


class Player(MongoBase):
    """Player account model for MongoDB."""
    username: str
    email: str
    password_hash: str  # Store hashed password
    characters: List[str] = Field(default_factory=list)  # Character IDs
    active_character: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "username": "player123",
                "email": "player@example.com",
                "password_hash": "hashed_password_here"
            }
        }
    )


class GameSession(MongoBase):
    """Active game session model."""
    socket_id: str  # Socket.io connection ID
    player_id: Optional[str] = None  # Logged in player ID
    character_id: Optional[str] = None  # Active character ID
    character_data: Optional[dict] = None  # Temporary character data for guests
    room: str = "spawn"
    connected_at: datetime = Field(default_factory=datetime.utcnow)
    last_activity: datetime = Field(default_factory=datetime.utcnow)
    is_guest: bool = True


class MongoDBConnection:
    """MongoDB connection manager."""
    client: Optional[AsyncIOMotorClient] = None
    database = None
    
    @classmethod
    async def connect(cls):
        """Create database connection."""
        if cls.client is None:
            # Get MongoDB URL from environment or use default
            # Use 'mongodb' as hostname when running in Docker, 'localhost' for local dev
            mongodb_url = os.getenv(
                "MONGODB_URI", 
                "mongodb://admin:adminpassword@mongodb:27017/alkema?authSource=admin"
            )
            cls.client = AsyncIOMotorClient(mongodb_url)
            cls.database = cls.client.alkema
            
            # Create indexes
            await cls.create_indexes()
            
            print("Connected to MongoDB")
    
    @classmethod
    async def disconnect(cls):
        """Close database connection."""
        if cls.client:
            cls.client.close()
            cls.client = None
            cls.database = None
            print("Disconnected from MongoDB")
    
    @classmethod
    async def create_indexes(cls):
        """Create database indexes for better performance."""
        if cls.database is not None:
            # Player indexes
            await cls.database.players.create_index("username", unique=True)
            await cls.database.players.create_index("email", unique=True)
            
            # Character indexes
            await cls.database.characters.create_index("owner_id")
            await cls.database.characters.create_index("name")
            
            # Session indexes
            await cls.database.sessions.create_index("socket_id", unique=True)
            await cls.database.sessions.create_index("player_id")
            await cls.database.sessions.create_index("last_activity")
    
    @classmethod
    def get_database(cls):
        """Get database instance."""
        if cls.database is None:
            raise RuntimeError("Database not connected. Call connect() first.")
        return cls.database


# Helper functions for database operations
async def get_database():
    """Dependency to get database instance."""
    return MongoDBConnection.get_database()


async def get_player_by_username(username: str) -> Optional[Player]:
    """Get player by username."""
    db = MongoDBConnection.get_database()
    player_data = await db.players.find_one({"username": username})
    return Player(**player_data) if player_data else None


async def get_character_by_id(character_id: str) -> Optional[Character]:
    """Get character by ID."""
    db = MongoDBConnection.get_database()
    character_data = await db.characters.find_one({"_id": ObjectId(character_id)})
    return Character(**character_data) if character_data else None


async def get_session_by_socket(socket_id: str) -> Optional[GameSession]:
    """Get session by socket ID."""
    db = MongoDBConnection.get_database()
    session_data = await db.sessions.find_one({"socket_id": socket_id})
    return GameSession(**session_data) if session_data else None
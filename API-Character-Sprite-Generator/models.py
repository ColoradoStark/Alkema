from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, Table, Boolean, Float, Text, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker
import os

Base = declarative_base()

item_tags = Table('item_tags', Base.metadata,
    Column('item_id', Integer, ForeignKey('items.id', ondelete='CASCADE'), primary_key=True),
    Column('tag_id', Integer, ForeignKey('tags.id', ondelete='CASCADE'), primary_key=True),
    Index('idx_item_tags_item', 'item_id'),
    Index('idx_item_tags_tag', 'tag_id')
)

item_required_tags = Table('item_required_tags', Base.metadata,
    Column('item_id', Integer, ForeignKey('items.id', ondelete='CASCADE'), primary_key=True),
    Column('tag_id', Integer, ForeignKey('tags.id', ondelete='CASCADE'), primary_key=True),
    Index('idx_item_required_tags_item', 'item_id'),
    Index('idx_item_required_tags_tag', 'tag_id')
)

item_excluded_tags = Table('item_excluded_tags', Base.metadata,
    Column('item_id', Integer, ForeignKey('items.id', ondelete='CASCADE'), primary_key=True),
    Column('tag_id', Integer, ForeignKey('tags.id', ondelete='CASCADE'), primary_key=True),
    Index('idx_item_excluded_tags_item', 'item_id'),
    Index('idx_item_excluded_tags_tag', 'tag_id')
)

item_animations = Table('item_animations', Base.metadata,
    Column('item_id', Integer, ForeignKey('items.id', ondelete='CASCADE'), primary_key=True),
    Column('animation_id', Integer, ForeignKey('animations.id', ondelete='CASCADE'), primary_key=True),
    Index('idx_item_animations_item', 'item_id'),
    Index('idx_item_animations_animation', 'animation_id')
)

class Item(Base):
    __tablename__ = 'items'
    
    id = Column(Integer, primary_key=True)
    file_name = Column(String(255), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    type_name = Column(String(100), nullable=False, index=True)
    match_body_color = Column(Boolean, default=False)
    fit_all_body_types = Column(Boolean, default=False)
    sheet = Column(String(50))
    template_data = Column(JSONB)
    replace_in_path = Column(JSONB)
    
    layers = relationship("ItemLayer", back_populates="item", cascade="all, delete-orphan")
    variants = relationship("ItemVariant", back_populates="item", cascade="all, delete-orphan")
    credits = relationship("ItemCredit", back_populates="item", cascade="all, delete-orphan")
    
    tags = relationship("Tag", secondary=item_tags, backref="items")
    required_tags = relationship("Tag", secondary=item_required_tags, backref="items_requiring")
    excluded_tags = relationship("Tag", secondary=item_excluded_tags, backref="items_excluding")
    animations = relationship("Animation", secondary=item_animations, backref="items")
    
    __table_args__ = (
        Index('idx_items_type_name', 'type_name'),
    )

class ItemLayer(Base):
    __tablename__ = 'item_layers'
    
    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey('items.id', ondelete='CASCADE'), nullable=False)
    layer_number = Column(Integer, nullable=False)
    z_pos = Column(Integer)
    custom_animation = Column(String(100), nullable=True)

    item = relationship("Item", back_populates="layers")
    body_types = relationship("ItemLayerBodyType", back_populates="layer", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint('item_id', 'layer_number', name='uq_item_layer'),
        Index('idx_item_layers_z_pos', 'z_pos'),
    )

class ItemLayerBodyType(Base):
    __tablename__ = 'item_layer_body_types'
    
    id = Column(Integer, primary_key=True)
    layer_id = Column(Integer, ForeignKey('item_layers.id', ondelete='CASCADE'), nullable=False)
    body_type = Column(String(50), nullable=False)
    sprite_path = Column(Text, nullable=False)
    
    layer = relationship("ItemLayer", back_populates="body_types")
    
    __table_args__ = (
        UniqueConstraint('layer_id', 'body_type', name='uq_layer_body_type'),
        Index('idx_item_layer_body_types_body_type', 'body_type'),
    )

class ItemVariant(Base):
    __tablename__ = 'item_variants'
    
    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey('items.id', ondelete='CASCADE'), nullable=False)
    name = Column(String(100), nullable=False)
    value = Column(String(100))
    rgb_values = Column(ARRAY(Integer))
    
    item = relationship("Item", back_populates="variants")
    
    __table_args__ = (
        UniqueConstraint('item_id', 'name', name='uq_item_variant'),
        Index('idx_item_variants_name', 'name'),
    )

class ItemCredit(Base):
    __tablename__ = 'item_credits'
    
    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey('items.id', ondelete='CASCADE'), nullable=False)
    body_type = Column(String(50))
    authors = Column(ARRAY(String))
    licenses = Column(ARRAY(String))
    urls = Column(ARRAY(String))
    
    item = relationship("Item", back_populates="credits")
    
    __table_args__ = (
        Index('idx_item_credits_item_body', 'item_id', 'body_type'),
    )

class Tag(Base):
    __tablename__ = 'tags'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    
    __table_args__ = (
        Index('idx_tags_name', 'name'),
    )

class Animation(Base):
    __tablename__ = 'animations'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False)
    row = Column(Integer)
    num_directions = Column(Integer)
    cycle = Column(String(100))
    custom_cycle = Column(String(100))
    
    __table_args__ = (
        Index('idx_animations_name', 'name'),
    )


class CustomAnimation(Base):
    __tablename__ = 'custom_animations'

    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    frame_size = Column(Integer, nullable=False)  # 64, 128, or 192
    num_directions = Column(Integer, nullable=False)  # typically 4
    num_frames = Column(Integer, nullable=False)  # frames per direction

    frames = relationship("CustomAnimationFrame", back_populates="custom_animation", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_custom_animations_name', 'name'),
    )


class CustomAnimationFrame(Base):
    __tablename__ = 'custom_animation_frames'

    id = Column(Integer, primary_key=True)
    custom_animation_id = Column(Integer, ForeignKey('custom_animations.id', ondelete='CASCADE'), nullable=False)
    direction_index = Column(Integer, nullable=False)  # 0=N, 1=W, 2=S, 3=E
    frame_index = Column(Integer, nullable=False)  # position in sequence
    source_animation = Column(String(50), nullable=False)  # e.g. 'slash'
    source_direction = Column(String(10), nullable=False)  # 'n', 'w', 's', 'e'
    source_frame = Column(Integer, nullable=False)  # column index in standard row

    custom_animation = relationship("CustomAnimation", back_populates="frames")

    __table_args__ = (
        UniqueConstraint('custom_animation_id', 'direction_index', 'frame_index', name='uq_custom_anim_frame'),
        Index('idx_custom_anim_frames_anim', 'custom_animation_id'),
    )


class BodyType(Base):
    __tablename__ = 'body_types'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False)
    display_name = Column(String(100))
    tags = Column(ARRAY(String))
    
    __table_args__ = (
        Index('idx_body_types_name', 'name'),
    )

def get_database_url():
    return os.getenv('DATABASE_URL', 'postgresql://alkema_user:alkema_pass@localhost:5432/alkema_db')

def create_db_engine():
    engine = create_engine(get_database_url())
    return engine

def create_session():
    engine = create_db_engine()
    Session = sessionmaker(bind=engine)
    return Session()

def init_database():
    engine = create_db_engine()
    Base.metadata.create_all(engine)
    return engine
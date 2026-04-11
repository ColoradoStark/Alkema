import mongoose from 'mongoose';

const equipmentItemSchema = new mongoose.Schema({
    id: String,
    name: String,
    layer: Number,
    stats: {
        attack: { type: Number, default: 0 },
        defense: { type: Number, default: 0 },
        speed: { type: Number, default: 0 }
    }
});

const characterSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 30
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player'
    },
    body_type: { type: String, default: 'male' },
    race: { type: String, default: 'human' },
    character_class: { type: String, default: null },
    armor: { type: String, default: null },
    color_palette: { type: String, default: null },
    level: { type: Number, default: 1 },
    experience: { type: Number, default: 0 },
    attributes: {
        strength: { type: Number, min: 3, max: 125, default: 10 },
        dexterity: { type: Number, min: 3, max: 125, default: 10 },
        intelligence: { type: Number, min: 3, max: 125, default: 10 },
        vitality: { type: Number, min: 3, max: 125, default: 10 },
        endurance: { type: Number, min: 3, max: 125, default: 10 },
        charisma: { type: Number, min: 3, max: 125, default: 10 }
    },
    stats: {
        health: { type: Number, default: 100 },
        maxHealth: { type: Number, default: 100 },
        mana: { type: Number, default: 50 },
        maxMana: { type: Number, default: 50 },
        attack: { type: Number, default: 10 },
        defense: { type: Number, default: 5 },
        speed: { type: Number, default: 5 }
    },
    position: {
        x: { type: Number, default: 512 },
        y: { type: Number, default: 384 },
        map: { type: String, default: 'spawn' }
    },
    selections: [{
        type: { type: String },
        item: { type: String },
        variant: { type: String }
    }],
    equipment: {
        armor: equipmentItemSchema,
        weapon: equipmentItemSchema,
        helmet: equipmentItemSchema,
        boots: equipmentItemSchema,
        gloves: equipmentItemSchema,
        accessory: equipmentItemSchema
    },
    inventory: [{
        itemId: String,
        quantity: Number,
        slot: Number
    }],
    metadata: {
        animationCoverage: mongoose.Schema.Types.Mixed,
        customAnimations: mongoose.Schema.Types.Mixed,
        blankedAnimations: [String],
        spriteSheetUrl: String,
        spriteSheetHash: String,
        lastUpdated: { type: Date, default: Date.now }
    },
    description: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

characterSchema.methods.getPublicData = function() {
    return {
        id: this._id,
        name: this.name,
        body_type: this.body_type,
        race: this.race,
        character_class: this.character_class,
        level: this.level,
        position: this.position,
        selections: this.selections,
        attributes: this.attributes,
        stats: this.stats,
        metadata: this.metadata
    };
};

characterSchema.methods.updateEquipment = async function(slot, item) {
    if (!this.equipment) {
        this.equipment = {};
    }

    this.equipment[slot] = item;
    this.metadata.lastUpdated = new Date();
    this.metadata.spriteSheetUrl = null;

    await this.save();
    return this.equipment;
};

export const Character = mongoose.model('Character', characterSchema);

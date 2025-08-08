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

const characterMetadataSchema = new mongoose.Schema({
    baseSprite: {
        body_type: { type: String, default: 'male' },
        head_type: { type: String, default: 'human' },
        skin_color: { type: String, default: 'light' },
        hair_style: { type: String, default: 'short' },
        hair_color: { type: String, default: 'brown' },
        eye_color: { type: String, default: 'brown' }
    },
    equipment: {
        armor: equipmentItemSchema,
        weapon: equipmentItemSchema,
        helmet: equipmentItemSchema,
        boots: equipmentItemSchema,
        gloves: equipmentItemSchema,
        accessory: equipmentItemSchema
    },
    animations: {
        available: [String],
        custom: mongoose.Schema.Types.Mixed
    },
    spriteSheetUrl: String,
    spriteSheetHash: String,
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

const characterSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 20
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player',
        required: true
    },
    level: {
        type: Number,
        default: 1
    },
    experience: {
        type: Number,
        default: 0
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
    metadata: characterMetadataSchema,
    inventory: [{
        itemId: String,
        quantity: Number,
        slot: Number
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

characterSchema.methods.getPublicData = function() {
    return {
        id: this._id,
        name: this.name,
        level: this.level,
        position: this.position,
        metadata: this.metadata,
        stats: {
            health: this.stats.health,
            maxHealth: this.stats.maxHealth
        }
    };
};

characterSchema.methods.updateEquipment = async function(slot, item) {
    if (!this.metadata.equipment) {
        this.metadata.equipment = {};
    }
    
    this.metadata.equipment[slot] = item;
    this.metadata.lastUpdated = new Date();
    this.metadata.spriteSheetUrl = null;
    
    await this.save();
    return this.metadata;
};

characterSchema.methods.detectAvailableAnimations = function() {
    const baseAnimations = ['idle', 'walk'];
    const weaponAnimations = {
        sword: ['attack', 'attack_combo'],
        bow: ['shoot', 'aim'],
        staff: ['cast', 'channel']
    };
    
    const availableAnimations = [...baseAnimations];
    
    if (this.metadata.equipment?.weapon) {
        const weaponType = this.metadata.equipment.weapon.id?.split('_')[0];
        if (weaponAnimations[weaponType]) {
            availableAnimations.push(...weaponAnimations[weaponType]);
        }
    }
    
    availableAnimations.push('hurt', 'die');
    
    this.metadata.animations = {
        available: availableAnimations,
        custom: {}
    };
    
    return availableAnimations;
};

export const Character = mongoose.model('Character', characterSchema);
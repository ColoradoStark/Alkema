import express from 'express';
import { Character } from '../models/Character.js';
import { authMiddleware } from '../middleware/auth.js';
import axios from 'axios';

export const characterRouter = express.Router();

characterRouter.get('/list', authMiddleware, async (req, res) => {
    try {
        const characters = await Character.find({ owner: req.playerId });
        res.json(characters.map(char => char.getPublicData()));
    } catch (error) {
        console.error('Error fetching characters:', error);
        res.status(500).json({ error: 'Failed to fetch characters' });
    }
});

characterRouter.post('/create', authMiddleware, async (req, res) => {
    try {
        const { name, metadata } = req.body;
        
        const existingCharacter = await Character.findOne({ name });
        if (existingCharacter) {
            return res.status(400).json({ error: 'Character name already exists' });
        }
        
        const character = new Character({
            name,
            owner: req.playerId,
            metadata: metadata || {}
        });
        
        character.detectAvailableAnimations();
        await character.save();
        
        res.status(201).json(character.getPublicData());
    } catch (error) {
        console.error('Error creating character:', error);
        res.status(500).json({ error: 'Failed to create character' });
    }
});

characterRouter.put('/:id/equipment', authMiddleware, async (req, res) => {
    try {
        const { slot, item } = req.body;
        
        const character = await Character.findOne({
            _id: req.params.id,
            owner: req.playerId
        });
        
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }
        
        await character.updateEquipment(slot, item);
        character.detectAvailableAnimations();
        await character.save();
        
        res.json({
            metadata: character.metadata,
            animations: character.metadata.animations
        });
    } catch (error) {
        console.error('Error updating equipment:', error);
        res.status(500).json({ error: 'Failed to update equipment' });
    }
});

characterRouter.get('/:id/sprite-metadata', authMiddleware, async (req, res) => {
    try {
        const character = await Character.findOne({
            _id: req.params.id,
            owner: req.playerId
        });
        
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }
        
        const apiResponse = await axios.get('http://localhost:8000/available-parameters');
        const availableParams = apiResponse.data;
        
        const metadata = {
            character: character.metadata,
            animations: character.detectAvailableAnimations(),
            availableCustomizations: availableParams,
            spriteUrl: character.metadata.spriteSheetUrl || null
        };
        
        res.json(metadata);
    } catch (error) {
        console.error('Error fetching sprite metadata:', error);
        res.status(500).json({ error: 'Failed to fetch sprite metadata' });
    }
});
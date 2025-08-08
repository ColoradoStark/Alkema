import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Player } from '../models/Player.js';

export const authRouter = express.Router();

authRouter.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        const existingPlayer = await Player.findOne({
            $or: [{ username }, { email }]
        });
        
        if (existingPlayer) {
            return res.status(400).json({ 
                error: 'Username or email already exists' 
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const player = new Player({
            username,
            email,
            password: hashedPassword
        });
        
        await player.save();
        
        const token = jwt.sign(
            { id: player._id },
            process.env.JWT_SECRET || 'default-secret-key',
            { expiresIn: '7d' }
        );
        
        res.status(201).json({
            token,
            player: {
                id: player._id,
                username: player.username,
                email: player.email
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Failed to register' });
    }
});

authRouter.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const player = await Player.findOne({ username });
        
        if (!player) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const isValidPassword = await bcrypt.compare(password, player.password);
        
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        player.lastLogin = new Date();
        await player.save();
        
        const token = jwt.sign(
            { id: player._id },
            process.env.JWT_SECRET || 'default-secret-key',
            { expiresIn: '7d' }
        );
        
        res.json({
            token,
            player: {
                id: player._id,
                username: player.username,
                email: player.email
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Failed to login' });
    }
});
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDatabase } from './config/database.js';
import { GameManager } from './services/GameManager.js';
import { authRouter } from './routes/auth.js';
import { characterRouter } from './routes/character.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: ['http://localhost:3000', 'http://localhost:3001'],
        methods: ['GET', 'POST']
    }
});

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/character', characterRouter);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const gameManager = new GameManager(io);

// Serve composited spritesheets
app.get('/api/sprites/:id.png', (req, res) => {
    const buffer = gameManager.spriteBuffers.get(req.params.id);
    if (!buffer) {
        return res.status(404).send('Sprite not found');
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
});

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    gameManager.handlePlayerConnection(socket);
});

const PORT = process.env.PORT || 3001;

async function startServer() {
    try {
        await connectDatabase();
        httpServer.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
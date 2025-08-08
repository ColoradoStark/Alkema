import { CompositeCharacter } from './CompositeCharacter.js';

export class Player {
    constructor(scene, x, y, id, characterData, isLocal = false) {
        this.scene = scene;
        this.id = id;
        this.isLocal = isLocal;
        this.characterData = characterData;
        
        console.log('Creating player sprite at:', x, y, 'for player:', id, 'isLocal:', isLocal);
        this.sprite = new CompositeCharacter(scene, x, y, characterData);
        
        // Set depth based on whether local or remote
        if (isLocal) {
            this.sprite.setDepth(20);
        } else {
            this.sprite.setDepth(10);
        }
        
        if (!isLocal) {
            this.targetX = x;
            this.targetY = y;
            this.interpolationSpeed = 0.1;
        }
        
        // Add name text as a child of the sprite container
        this.nameText = scene.add.text(0, -40, characterData?.name || 'Player', {
            fontFamily: 'Alagard',
            fontSize: '14px',
            color: '#ffffff',
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 }
        }).setOrigin(0.5);
        
        // Add the name text to the sprite container so it moves with it
        this.sprite.add(this.nameText);
    }

    setVelocity(vx, vy) {
        if (this.isLocal) {
            if (!this.sprite.body) {
                console.warn('No physics body for local player!');
                return;
            }
            this.sprite.body.setVelocity(vx, vy);
            
            let direction = null;
            
            // Determine direction based on velocity
            if (Math.abs(vx) > Math.abs(vy)) {
                // Horizontal movement is stronger
                if (vx < 0) direction = 'left';
                else if (vx > 0) direction = 'right';
            } else if (vy !== 0) {
                // Vertical movement is stronger or equal
                if (vy < 0) direction = 'up';
                else if (vy > 0) direction = 'down';
            }
            
            if (vx !== 0 || vy !== 0) {
                // Moving - play walk animation with direction
                if (direction) {
                    this.sprite.setDirection(direction);
                    this.sprite.playAnimation('walk', direction);
                }
            } else {
                // Stopped - play idle animation (will use last direction)
                this.sprite.stopAnimation();
            }
        }
    }

    setTargetPosition(x, y) {
        this.targetX = x;
        this.targetY = y;
    }

    updateAppearance(characterData) {
        this.characterData = characterData;
        this.sprite.updateCharacter(characterData);
    }

    update(delta) {
        if (!this.isLocal && this.sprite) {
            const dx = this.targetX - this.sprite.x;
            const dy = this.targetY - this.sprite.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > 2) {
                // Use lerp for smoother movement
                const lerpFactor = Math.min(this.interpolationSpeed * (delta / 16.67), 1);
                this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, lerpFactor);
                this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, lerpFactor);
                
                let direction;
                if (Math.abs(dx) > Math.abs(dy)) {
                    direction = dx > 0 ? 'right' : 'left';
                } else {
                    direction = dy > 0 ? 'down' : 'up';
                }
                
                this.sprite.setDirection(direction);
                this.sprite.playAnimation('walk', direction);
            } else {
                // Snap to final position when very close
                this.sprite.x = this.targetX;
                this.sprite.y = this.targetY;
                this.sprite.stopAnimation();
            }
        }
        
        // Name text now moves automatically as part of the container
    }

    destroy() {
        if (this.sprite) {
            this.sprite.destroy();
        }
        if (this.nameText) {
            this.nameText.destroy();
        }
    }
}
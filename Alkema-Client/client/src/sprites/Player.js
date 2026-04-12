import { CompositeCharacter } from './CompositeCharacter.js';

export class Player {
    constructor(scene, x, y, id, characterData, isLocal = false) {
        this.scene = scene;
        this.id = id;
        this.isLocal = isLocal;
        this.characterData = characterData;
        
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

        // Show "Loading..." until sprite is ready, then show real name
        this.nameText = scene.add.text(0, -40, 'Spawning...', {
            fontFamily: 'Alagard',
            fontSize: '14px',
            color: '#ffffff',
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 }
        }).setOrigin(0.5);

        this.sprite.onLoaded = () => {
            this.nameText.setText(characterData?.name || 'Player');
        };

        // Add the name text to the sprite container so it moves with it
        this.sprite.add(this.nameText);
    }

    playAttack() {
        if (this.isAttacking) return;
        this.isAttacking = true;

        // Stop movement during attack
        if (this.sprite.body) {
            this.sprite.body.setVelocity(0, 0);
        }

        // Pick animation based on weapon type from selections
        const attackAnim = this.getAttackAnimation();
        const dir = this.sprite.currentDirection || 'down';

        this.sprite.playAnimation(attackAnim, dir);

        // Listen for animation complete to return to idle
        if (this.sprite.sprite) {
            this.sprite.sprite.once('animationcomplete', () => {
                this.isAttacking = false;
                this.sprite.stopAnimation();
            });
        }
    }

    getAttackAnimation() {
        const selections = this.characterData?.selections || [];
        const weapon = selections.find(s => s.type === 'weapon');
        if (!weapon) return 'thrust'; // unarmed

        // weapon.item format: "weapon_sword_longsword", "weapon_ranged_bow_great", etc.
        const parts = weapon.item.split('_');
        const weaponCategory = parts[1]; // sword, ranged, blunt, magic, polearm, tool

        switch (weaponCategory) {
            case 'sword': return 'slash';
            case 'ranged': return 'shoot';
            case 'magic': return 'spellcast';
            case 'polearm': return 'thrust';
            case 'blunt': return 'slash';
            case 'tool': return 'slash';
            default: return 'slash';
        }
    }

    setVelocity(vx, vy) {
        if (this.isAttacking) return; // Don't move during attack
        if (this.isLocal) {
            if (!this.sprite.body) {
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
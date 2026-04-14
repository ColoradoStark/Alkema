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
        this._attackId = (this._attackId || 0) + 1;
        const attackId = this._attackId;

        // Stop movement during attack
        if (this.sprite.body) {
            this.sprite.body.setVelocity(0, 0);
        }

        const dir = this.sprite.currentDirection || 'down';

        // Melee button: use melee animation, but if weapon is ranged, shoot + arrow
        const rangedAnim = this.getRangedAnimation();
        if (rangedAnim) {
            this.sprite.playAnimation(rangedAnim, dir);
            setTimeout(() => this.spawnArrow(dir), 200);
        } else {
            const meleeAnim = this.getMeleeAnimation();
            this.sprite.playAnimation(meleeAnim, dir);
        }

        const finishAttack = () => {
            if (this._attackId !== attackId) return;
            this.isAttacking = false;
            this.sprite.stopAnimation();
        };

        this.sprite.onAnimationComplete(finishAttack);
        setTimeout(finishAttack, 750);
    }

    playCast() {
        if (this.isAttacking) return;
        this.isAttacking = true;
        this._attackId = (this._attackId || 0) + 1;
        const attackId = this._attackId;

        if (this.sprite.body) {
            this.sprite.body.setVelocity(0, 0);
        }

        const dir = this.sprite.currentDirection || 'down';
        this.sprite.playAnimation('spellcast', dir);

        const finishCast = () => {
            if (this._attackId !== attackId) return;
            this.isAttacking = false;
            this.sprite.stopAnimation();
        };

        this.sprite.onAnimationComplete(finishCast);
        setTimeout(finishCast, 500);
    }

    spawnArrow(direction) {
        if (!this.scene.textures.exists('arrow-projectile')) return;

        // Use left/right arrow rows and rotate for up/down
        // Row 1 = left, Row 3 = right, frames 0-8 animate then hold
        const row = (direction === 'left' || direction === 'up') ? 1 : 3;
        const startFrame = row * 13;

        const frame = startFrame + 5;

        // Arrow spawn offset from character center, per weapon and direction.
        // Aligns the projectile with the weapon's muzzle/release point in the
        // attack animation. Positive X = right, positive Y = down.
        const ARROW_OFFSETS = {
            bow:      { up: { x:  3, y: -32 }, down: { x: -3, y: 12 }, left: { x: 0, y:  3 }, right: { x: 0, y:  3 } },
            crossbow: { up: { x:  6, y: -32 }, down: { x: -6, y: 12 }, left: { x: 0, y: 15 }, right: { x: 0, y: 15 } },
        };

        const selections = this.characterData?.selections || [];
        const weapon = selections.find(s => s.type === 'weapon');
        const weaponType = weapon?.item.split('_')[2]; // bow, crossbow, slingshot
        const offsets = ARROW_OFFSETS[weaponType] || ARROW_OFFSETS.bow;
        const { x: offsetX, y: offsetY } = offsets[direction] || { x: 0, y: 0 };

        const arrow = this.scene.add.sprite(this.sprite.x + offsetX, this.sprite.y + offsetY, 'arrow-projectile', frame);
        arrow.setDepth(25);
        if (direction === 'up') arrow.setRotation(Math.PI / 2);
        if (direction === 'down') arrow.setRotation(Math.PI / 2);

        const speed = 300;
        const velocity = { up: { x: 0, y: -speed }, down: { x: 0, y: speed }, left: { x: -speed, y: 0 }, right: { x: speed, y: 0 } };
        const vel = velocity[direction] || velocity.down;

        // Use scene update to move the arrow each frame
        const updateArrow = (time, delta) => {
            arrow.x += vel.x * (delta / 1000);
            arrow.y += vel.y * (delta / 1000);

            // Remove when far offscreen from camera
            const cam = this.scene.cameras.main;
            const margin = 100;
            if (arrow.x < cam.scrollX - margin || arrow.x > cam.scrollX + cam.width + margin ||
                arrow.y < cam.scrollY - margin || arrow.y > cam.scrollY + cam.height + margin) {
                arrow.destroy();
                this.scene.events.off('update', updateArrow);
            }
        };

        this.scene.events.on('update', updateArrow);
    }

    getMeleeAnimation() {
        const selections = this.characterData?.selections || [];
        const weapon = selections.find(s => s.type === 'weapon');
        if (!weapon) return 'thrust'; // unarmed

        // weapon.item format: "weapon_sword_longsword", "weapon_ranged_bow_great", etc.
        const parts = weapon.item.split('_');
        const weaponCategory = parts[1]; // sword, ranged, blunt, magic, polearm, tool
        const weaponName = parts[2]; // specific weapon name

        switch (weaponCategory) {
            case 'sword': return 'slash';
            case 'ranged': return 'thrust'; // melee fallback for bows
            case 'magic':
                // wand uses slash, all staffs use thrust
                return weaponName === 'wand' ? 'slash' : 'thrust';
            case 'polearm': return 'thrust';
            case 'blunt': return 'slash';
            case 'tool': return 'slash';
            default: return 'slash';
        }
    }

    getRangedAnimation() {
        const selections = this.characterData?.selections || [];
        const weapon = selections.find(s => s.type === 'weapon');
        if (!weapon) return null;

        const parts = weapon.item.split('_');
        const weaponCategory = parts[1];
        const weaponType = parts[2]; // bow, crossbow, slingshot, boomerang

        if (weaponCategory !== 'ranged') return null;

        // Bows use shoot animation, crossbow/slingshot use thrust
        // All spawn an arrow projectile
        return weaponType === 'bow' ? 'shoot' : 'thrust';
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

    applySpriteMeta(meta) {
        this.sprite.applySpriteMeta(meta);
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

                if (!this.isAttacking) {
                    let direction;
                    if (Math.abs(dx) > Math.abs(dy)) {
                        direction = dx > 0 ? 'right' : 'left';
                    } else {
                        direction = dy > 0 ? 'down' : 'up';
                    }

                    this.sprite.setDirection(direction);
                    this.sprite.playAnimation('walk', direction);
                }
            } else {
                // Snap to final position when very close
                this.sprite.x = this.targetX;
                this.sprite.y = this.targetY;
                if (!this.isAttacking) {
                    this.sprite.stopAnimation();
                }
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
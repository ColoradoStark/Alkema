import { CompositeCharacter } from './CompositeCharacter.js';
import { getWeaponItemKey, getWeaponType, getMeleeAnimation, getRangedAnimation } from './weaponTypes.js';
import { spawnArrow, spawnRock } from './ProjectileSpawner.js';

const WEAPON_COMBO_ATTACKS = {
    'weapon_sword_longsword':  ['slash', 'slash_reverse', 'thrust'],
    'weapon_sword_arming':     ['backslash', 'halfslash', 'slash'],
    'weapon_sword_dagger':     ['slash', 'thrust'],
    'weapon_polearm_halberd':  ['slash', 'thrust'],
};

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
            // At 60fps with speed=160, the target advances ~2.67 px/frame.
            // A lerp factor of 0.1 leaves the remote sprite ~27 px behind
            // the sender at steady state, which reads as obvious lag when
            // walking past other players. 0.3 cuts that to ~9 px while
            // still looking smooth.
            this.interpolationSpeed = 0.3;
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

        // Combo attack state
        this.comboIndex = 0;
        this.lastAttackTime = 0;
    }

    playAttack(onAttackFired) {
        // If mid-attack, buffer the input so it fires when the current one ends
        if (this.isAttacking) {
            this._bufferedAttack = onAttackFired || true;
            return;
        }

        // Reset combo if this is a fresh press (not from buffer) and enough time passed
        const fromBuffer = this._comboFromBuffer;
        this._comboFromBuffer = false;
        if (!fromBuffer && Date.now() - this.lastAttackTime > 1500) {
            this.comboIndex = -1; // will become 0 after increment
        }

        this.isAttacking = true;
        this._attackId = (this._attackId || 0) + 1;
        const attackId = this._attackId;

        // Stop movement during attack
        if (this.sprite.body) {
            this.sprite.body.setVelocity(0, 0);
        }

        const dir = this.sprite.currentDirection || 'down';

        // Melee button: use melee animation, but if weapon is ranged, shoot + projectile
        const rangedAnim = getRangedAnimation(this.characterData);
        if (rangedAnim) {
            this.sprite.playAnimation(rangedAnim, dir);
            this.lastAttackType = rangedAnim;
            const weaponType = getWeaponType(this.characterData);
            if (weaponType === 'slingshot') {
                setTimeout(() => spawnRock(this.scene, this.sprite.x, this.sprite.y, dir), 200);
            } else {
                setTimeout(() => spawnArrow(this.scene, this.sprite.x, this.sprite.y, dir, weaponType), 200);
            }
        } else {
            const weaponKey = getWeaponItemKey(this.characterData);
            const comboList = weaponKey ? WEAPON_COMBO_ATTACKS[weaponKey] : null;
            let meleeAnim;

            if (comboList) {
                this.comboIndex = (this.comboIndex + 1) % comboList.length;
                meleeAnim = comboList[this.comboIndex];
            } else {
                meleeAnim = getMeleeAnimation(this.characterData);
            }

            this.sprite.playAnimation(meleeAnim, dir);
            this.lastAttackType = meleeAnim;
        }

        // Fire the callback so the caller can emit the network event
        if (onAttackFired) onAttackFired();

        this.lastAttackTime = Date.now();

        const finishAttack = () => {
            if (this._attackId !== attackId) return;
            this.isAttacking = false;
            this.sprite.stopAnimation();

            // If an attack was buffered during this animation, fire it now
            const buffered = this._bufferedAttack;
            if (buffered) {
                this._bufferedAttack = null;
                this._comboFromBuffer = true;
                this.playAttack(typeof buffered === 'function' ? buffered : undefined);
            }
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

    // Backward-compat delegate methods (GameScene's remote player-attacked handler calls spawnArrow/spawnRock on the Player instance)
    spawnArrow(direction) {
        spawnArrow(this.scene, this.sprite.x, this.sprite.y, direction, getWeaponType(this.characterData));
    }

    spawnRock(direction) {
        spawnRock(this.scene, this.sprite.x, this.sprite.y, direction);
    }

    // Backward-compat delegate methods (GameScene's remote player-attacked handler calls these on the Player instance)
    getMeleeAnimation() {
        return getMeleeAnimation(this.characterData);
    }

    getRangedAnimation() {
        return getRangedAnimation(this.characterData);
    }

    getWeaponItemKey() {
        return getWeaponItemKey(this.characterData);
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

    setTargetPosition(x, y, vx = 0, vy = 0) {
        this.targetX = x;
        this.targetY = y;
        // Sender's velocity is the authoritative "is the player walking?"
        // signal. Deciding based on local position-vs-target distance is
        // unreliable: when new positions arrive faster than the lerp can
        // close the gap, distance can dip below any small threshold every
        // frame, causing the walk animation to flicker on and off.
        this.targetVx = vx;
        this.targetVy = vy;
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

            // Lerp position toward target (always — even tiny distances,
            // so the remote sprite stays synced with the sender).
            if (distance > 0.5) {
                const lerpFactor = Math.min(this.interpolationSpeed * (delta / 16.67), 1);
                this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, lerpFactor);
                this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, lerpFactor);
            } else {
                this.sprite.x = this.targetX;
                this.sprite.y = this.targetY;
            }

            // Pick walk vs idle from the sender's velocity, not local distance.
            if (!this.isAttacking) {
                const vx = this.targetVx || 0;
                const vy = this.targetVy || 0;
                const isMoving = vx !== 0 || vy !== 0;
                if (isMoving) {
                    // Prefer server-supplied direction; fall back to velocity.
                    let dir = this.sprite.currentDirection;
                    if (Math.abs(vx) > Math.abs(vy)) {
                        dir = vx < 0 ? 'left' : 'right';
                    } else if (vy !== 0) {
                        dir = vy < 0 ? 'up' : 'down';
                    }
                    this.sprite.playAnimation('walk', dir);
                } else {
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
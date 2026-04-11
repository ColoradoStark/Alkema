export class CompositeCharacter extends Phaser.GameObjects.Container {
    constructor(scene, x, y, characterData) {
        super(scene, x, y);

        this.scene = scene;
        this.characterData = characterData || {};
        this.layers = {};
        this.layerFrameInfo = {}; // Per-layer frame size and columns
        this.animationKey = null;
        this.currentDirection = 'down';

        scene.add.existing(this);
        scene.physics.add.existing(this);

        // Set physics body size
        this.body.setSize(32, 48);

        // Keep container visible for physics, but alpha 0 until loaded
        this.setAlpha(0);

        // Load character layers
        this.loadCharacterLayers().then(() => {
            this.setAlpha(1);
        }).catch(err => {
            this.setAlpha(1); // Show anyway
        });
    }

    async loadCharacterLayers() {
        const selections = this.characterData.selections;

        // New path: selections array with sprite_path from the API
        if (selections && selections.length > 0) {
            // First pass: load behind layers (low z-order, rendered below body)
            for (const sel of selections) {
                if (!sel.sprite_path_behind) continue;
                await this.loadLayer(`${sel.type}_behind`, `/spritesheets/${sel.sprite_path_behind}`, true);
            }

            // Second pass: load main layers (normal z-order)
            for (const sel of selections) {
                if (!sel.sprite_path) continue;
                await this.loadLayer(sel.type, `/spritesheets/${sel.sprite_path}`, true);
            }
        } else {
            // Legacy flat format fallback
            const bodyType = this.characterData.body_type || 'male';
            const skinColor = this.characterData.skin_color || 'light';
            const hairStyle = this.characterData.hair_style || 'plain';
            const hairColor = this.characterData.hair_color || 'brown';
            const shirtColor = this.characterData.shirt_color || 'blue';
            const pantsColor = this.characterData.pants_color || 'brown';
            const shirtType = this.characterData.shirt_type || (bodyType === 'female' ? 'tunic' : 'vest');

            const layerConfigs = [
                { name: 'shadow', url: `/spritesheets/shadow/adult/walk/shadow.png`, optional: true },
                { name: 'body', url: `/spritesheets/body/bodies/${bodyType}/walk/${skinColor}.png` },
                { name: 'pants', url: `/spritesheets/legs/pants/${bodyType}/walk/${pantsColor}.png`, optional: true },
                { name: 'shirt', url: `/spritesheets/torso/clothes/${shirtType}/${bodyType}/walk/${shirtColor}.png`, optional: true },
                { name: 'head', url: `/spritesheets/head/heads/human/${bodyType}/walk/${skinColor}.png` },
                { name: 'hair', url: `/spritesheets/hair/${hairStyle}/adult/walk/${hairColor}.png`, optional: true }
            ];
            for (const config of layerConfigs) {
                await this.loadLayer(config.name, config.url, config.optional);
            }
        }

        this.createAnimations();
        this.playAnimation('idle', 'down');
    }

    async loadLayer(layerName, url, optional = false) {
        const layerKey = `${this.characterData.id}_${layerName}`;

        // Check if already loaded
        if (this.scene.textures.exists(layerKey)) {
            const info = this.layerFrameInfo[layerName] || { frameSize: 64, cols: 9 };
            this.addLayerSprite(layerName, layerKey);
            return;
        }

        // Load image
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.onload = () => {
                // Detect oversized sprites (128x128 frames vs standard 64x64)
                const frameSize = (img.width > 576 || img.height > 256) ? 128 : 64;
                const cols = Math.floor(img.width / frameSize);

                this.layerFrameInfo[layerName] = { frameSize, cols };

                this.scene.textures.addSpriteSheet(layerKey, img, {
                    frameWidth: frameSize,
                    frameHeight: frameSize
                });
                this.addLayerSprite(layerName, layerKey);
                resolve();
            };

            img.onerror = () => {
                // Silently handle missing optional layers
                resolve();
            };

            img.src = url;
        });
    }

    addLayerSprite(layerName, textureKey) {
        // Create sprite for this layer
        const sprite = this.scene.add.sprite(0, 0, textureKey, 0);

        // Add to container
        this.add(sprite);

        // Store reference
        this.layers[layerName] = sprite;
    }

    createAnimations() {
        if (Object.keys(this.layers).length === 0) return;

        this.animationKey = `${this.characterData.id}_anims`;

        // LPC spritesheet layout (rows):
        // 0: Walk up, 1: Walk left, 2: Walk down, 3: Walk right
        const directions = ['up', 'left', 'down', 'right'];

        // Create animations for each layer and direction
        Object.entries(this.layers).forEach(([layerName, sprite]) => {
            const info = this.layerFrameInfo[layerName] || { frameSize: 64, cols: 9 };
            const framesPerRow = info.cols;

            directions.forEach((direction, row) => {
                const walkKey = `${this.animationKey}_${layerName}_walk_${direction}`;
                const idleKey = `${this.animationKey}_${layerName}_idle_${direction}`;

                if (!this.scene.anims.exists(walkKey)) {
                    const startFrame = row * framesPerRow;
                    // Use up to 9 frames for walk (standard cycle length)
                    const walkFrames = Math.min(framesPerRow, 9);

                    // Walk animation
                    this.scene.anims.create({
                        key: walkKey,
                        frames: this.scene.anims.generateFrameNumbers(sprite.texture.key, {
                            start: startFrame,
                            end: startFrame + walkFrames - 1
                        }),
                        frameRate: 10,
                        repeat: -1
                    });

                    // Idle animation (first frame of walk)
                    this.scene.anims.create({
                        key: idleKey,
                        frames: [ { key: sprite.texture.key, frame: startFrame } ],
                        frameRate: 1,
                        repeat: 0
                    });
                }
            });
        });
    }

    playAnimation(animName, direction = null) {
        if (Object.keys(this.layers).length === 0) return;

        const dir = direction || this.currentDirection || 'down';

        if (direction) {
            this.currentDirection = direction;
        }

        // Play animation on all layers
        Object.entries(this.layers).forEach(([layerName, sprite]) => {
            const animKey = `${this.animationKey}_${layerName}_${animName}_${dir}`;
            if (this.scene.anims.exists(animKey)) {
                sprite.play(animKey, true);
            }
        });
    }

    stopAnimation() {
        this.playAnimation('idle', this.currentDirection);
    }

    setDirection(direction) {
        this.currentDirection = direction;
    }
}

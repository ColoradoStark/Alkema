export class CharacterSprite extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, characterData) {
        super(scene, x, y, 'placeholder');
        
        this.scene = scene;
        this.characterData = characterData || {};
        this.currentAnimation = 'idle';
        this.direction = 'down';
        this.animationDetected = false;
        
        scene.add.existing(this);
        scene.physics.add.existing(this);
        
        this.setSize(32, 48);
        this.setDisplaySize(64, 64);
        
        this.createPlaceholder();
        this.loadCharacterSprite();
    }

    async loadCharacterSprite() {
        try {
            console.log('Loading sprite for character:', this.characterData);
            
            const bodyType = this.characterData.body_type || 'male';
            const skinColor = this.characterData.skin_color || 'light';
            
            // Create a composite sprite with body and head
            this.createCompositeSprite(bodyType, skinColor);
            
        } catch (error) {
            console.error('Failed to load character sprite:', error);
            this.createPlaceholder();
        }
    }
    
    createCompositeSprite(bodyType, skinColor) {
        const textureKey = this.characterData.id || 'character_' + Math.random();
        
        // URLs for body and head
        const bodyUrl = `http://localhost:8080/spritesheets/body/bodies/${bodyType}/walk/${skinColor}.png`;
        const headUrl = `http://localhost:8080/spritesheets/head/heads/heads_human_${bodyType}/walk.png`;
        
        // Also add hair and basic clothes
        const hairStyle = this.characterData.hair_style || 'plain';
        const hairColor = this.characterData.hair_color || 'brown';
        const hairUrl = `http://localhost:8080/spritesheets/hair/${hairStyle}/adult/walk/${hairColor}.png`;
        const pantsUrl = `http://localhost:8080/spritesheets/legs/pants/${bodyType}/walk/teal.png`;
        const shirtUrl = `http://localhost:8080/spritesheets/torso/clothes/shirt_long/${bodyType}/walk/white.png`;
        
        // Track loaded layers
        let loadedLayers = 0;
        const totalLayers = 5;
        const layers = [];
        
        // Load all layers
        const loadLayer = (url, layerName) => {
            return new Promise((resolve) => {
                const layerKey = `${textureKey}_${layerName}`;
                
                this.scene.load.spritesheet(layerKey, url, {
                    frameWidth: 64,
                    frameHeight: 64
                });
                
                this.scene.load.once('complete', () => {
                    console.log(`Loaded ${layerName} layer`);
                    layers.push({ key: layerKey, name: layerName });
                    loadedLayers++;
                    
                    if (loadedLayers === totalLayers) {
                        this.assembleLayers(textureKey, layers);
                    }
                    resolve();
                });
                
                this.scene.load.once('loaderror', () => {
                    console.warn(`Failed to load ${layerName} layer from ${url}`);
                    loadedLayers++;
                    
                    if (loadedLayers === totalLayers) {
                        this.assembleLayers(textureKey, layers);
                    }
                    resolve();
                });
                
                this.scene.load.start();
            });
        };
        
        // Load all layers in parallel
        Promise.all([
            loadLayer(bodyUrl, 'body'),
            loadLayer(headUrl, 'head'),
            loadLayer(hairUrl, 'hair'),
            loadLayer(pantsUrl, 'pants'),
            loadLayer(shirtUrl, 'shirt')
        ]);
    }
    
    assembleLayers(textureKey, layers) {
        if (layers.length === 0) {
            this.createPlaceholder();
            return;
        }
        
        // Use the first successful layer as base
        const baseLayer = layers[0];
        this.setTexture(baseLayer.key, 0);
        
        // Create walk animation using the base layer
        if (!this.scene.anims.exists(textureKey + '_walk')) {
            this.scene.anims.create({
                key: textureKey + '_walk',
                frames: this.scene.anims.generateFrameNumbers(baseLayer.key, { start: 0, end: 8 }),
                frameRate: 10,
                repeat: -1
            });
        }
        
        // Play animation
        this.play(textureKey + '_walk');
        
        // Note: In a full implementation, you'd composite these layers into a single texture
        // For now, we're just showing the body layer with the animation
        console.log('Character sprite assembled with layers:', layers.map(l => l.name));
    }

    createPlaceholder() {
        if (!this.scene.textures.exists('placeholder')) {
            const graphics = this.scene.add.graphics();
            graphics.fillStyle(0x808080, 1);
            graphics.fillRect(0, 0, 32, 48);
            graphics.generateTexture('placeholder', 32, 48);
            graphics.destroy();
        }
        
        this.setTexture('placeholder');
        this.body.enable = true;
    }

    detectAvailableAnimations() {
        const texture = this.scene.textures.get(this.characterData.id);
        if (!texture) return;
        
        const frameWidth = 64;
        const frameHeight = 64;
        const sourceImage = texture.source[0];
        
        this.availableAnimations = {
            idle: { row: 0, frames: 1, detected: true },
            walk: { row: 0, frames: 9, detected: false },
            attack: { row: 0, frames: 6, detected: false },
            hurt: { row: 0, frames: 3, detected: false },
            die: { row: 0, frames: 3, detected: false }
        };
        
        const animationMap = {
            walk: { south: 10, west: 9, east: 11, north: 8 },
            attack: { south: 2, west: 1, east: 3, north: 0 },
            hurt: { south: 20, frames: 6 },
            die: { south: 20, frames: 6 }
        };
        
        Object.keys(animationMap).forEach(animName => {
            const anim = animationMap[animName];
            const row = anim.south || 0;
            const y = row * frameHeight;
            
            if (y < sourceImage.height) {
                this.availableAnimations[animName].detected = true;
                this.availableAnimations[animName].row = row;
            }
        });
        
        this.animationDetected = true;
    }

    createAnimations() {
        if (!this.animationDetected) return;
        
        const texture = this.characterData.id;
        const frameWidth = 64;
        const frameHeight = 64;
        
        Object.keys(this.availableAnimations).forEach(animName => {
            const anim = this.availableAnimations[animName];
            if (!anim.detected) return;
            
            const key = `${texture}_${animName}`;
            
            if (!this.scene.anims.exists(key)) {
                const frames = [];
                for (let i = 0; i < anim.frames; i++) {
                    frames.push({
                        key: texture,
                        frame: anim.row * 13 + i
                    });
                }
                
                this.scene.anims.create({
                    key: key,
                    frames: frames,
                    frameRate: animName === 'idle' ? 2 : 10,
                    repeat: -1
                });
            }
        });
    }

    playAnimation(animName) {
        if (!this.animationDetected) return;
        
        const anim = this.availableAnimations[animName];
        if (!anim || !anim.detected) {
            animName = 'idle';
        }
        
        if (this.currentAnimation !== animName) {
            this.currentAnimation = animName;
            const key = `${this.characterData.id}_${animName}`;
            if (this.scene.anims.exists(key)) {
                this.play(key, true);
            }
        }
    }

    setDirection(direction) {
        this.direction = direction;
    }

    updateCharacter(characterData) {
        this.characterData = characterData;
        this.loadCharacterSprite();
    }
}
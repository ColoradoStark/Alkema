export class CompositeCharacter extends Phaser.GameObjects.Container {
    constructor(scene, x, y, characterData) {
        super(scene, x, y);
        
        this.scene = scene;
        this.characterData = characterData || {};
        this.layers = {};
        this.animationKey = null;
        this.currentDirection = 'down';
        
        scene.add.existing(this);
        scene.physics.add.existing(this);
        
        // Set physics body size
        this.body.setSize(32, 48);
        
        // Start visible
        this.setVisible(true);
        
        // Load character layers
        this.loadCharacterLayers();
    }
    
    async loadCharacterLayers() {
        const bodyType = this.characterData.body_type || 'male';
        const skinColor = this.characterData.skin_color || 'light';
        
        // Define layer URLs in order (bottom to top)
        const layerConfigs = [
            { name: 'body', url: `http://localhost:8080/spritesheets/body/bodies/${bodyType}/walk/${skinColor}.png` },
            { name: 'head', url: `http://localhost:8080/spritesheets/head/heads/human/${bodyType}/walk/${skinColor}.png` }
        ];
        
        // Load each layer
        for (const config of layerConfigs) {
            await this.loadLayer(config.name, config.url);
        }
        
        this.createAnimations();
        this.playAnimation('idle', 'down');
    }
    
    async loadLayer(layerName, url) {
        const layerKey = `${this.characterData.id}_${layerName}`;
        
        // Check if already loaded
        if (this.scene.textures.exists(layerKey)) {
            this.addLayerSprite(layerName, layerKey);
            return;
        }
        
        // Load image
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                this.scene.textures.addSpriteSheet(layerKey, img, {
                    frameWidth: 64,
                    frameHeight: 64
                });
                this.addLayerSprite(layerName, layerKey);
                resolve();
            };
            
            img.onerror = () => {
                console.warn(`Failed to load ${layerName}`);
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
        const directions = {
            'up': { row: 0, frames: 9 },
            'left': { row: 1, frames: 9 },
            'down': { row: 2, frames: 9 },
            'right': { row: 3, frames: 9 }
        };
        
        // Create animations for each layer and direction
        Object.entries(this.layers).forEach(([layerName, sprite]) => {
            Object.entries(directions).forEach(([direction, config]) => {
                const walkKey = `${this.animationKey}_${layerName}_walk_${direction}`;
                const idleKey = `${this.animationKey}_${layerName}_idle_${direction}`;
                
                if (!this.scene.anims.exists(walkKey)) {
                    const startFrame = config.row * 9;
                    
                    // Walk animation
                    this.scene.anims.create({
                        key: walkKey,
                        frames: this.scene.anims.generateFrameNumbers(sprite.texture.key, { 
                            start: startFrame, 
                            end: startFrame + config.frames - 1
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
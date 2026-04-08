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
        const bodyType = this.characterData.body_type || 'male';
        const skinColor = this.characterData.skin_color || 'light';
        const hairStyle = this.characterData.hair_style || 'plain';
        let hairColor = this.characterData.hair_color || 'brown';
        const shirtColor = this.characterData.shirt_color || 'blue';
        const pantsColor = this.characterData.pants_color || 'brown';
        
        // Map hair colors to actual file names - many styles use different color naming
        const hairColorMap = {
            'brown': 'dark_brown',
            'blonde': 'blonde',
            'black': 'black',
            'red': 'red',
            'gray': 'gray',
            'grey': 'gray',
            'white': 'white'
        };
        
        // Apply color mapping for styles that need it
        const mappedHairColor = hairColorMap[hairColor] || hairColor;
        
        // Define layer URLs in order (bottom to top)
        // Use shirt_type from character data if available, otherwise default based on gender
        const shirtType = this.characterData.shirt_type || (bodyType === 'female' ? 'tunic' : 'vest');
        
        
        // Base layer configs
        const layerConfigs = [
            { name: 'body', url: `/spritesheets/body/bodies/${bodyType}/walk/${skinColor}.png` },
            { name: 'pants', url: `/spritesheets/legs/pants/${bodyType}/walk/${pantsColor}.png`, optional: true },
            { name: 'shirt', url: `/spritesheets/torso/clothes/${shirtType}/${bodyType}/walk/${shirtColor}.png`, optional: false }, // Made required for debugging
            { name: 'head', url: `/spritesheets/head/heads/human/${bodyType}/walk/${skinColor}.png` }
        ];
        
        // Handle special hair styles that have bg/fg structure
        // These hairstyles need both background and foreground layers
        const twoLayerHairStyles = ['ponytail', 'ponytail2', 'princess', 'shoulderl', 'shoulderr', 'pigtails'];
        
        if (twoLayerHairStyles.includes(hairStyle)) {
            // These styles have background (behind head) and foreground (the actual detail)
            // Note: fg layer doesn't have color variants - it's just the shape overlay
            layerConfigs.push(
                { name: 'hair_bg', url: `/spritesheets/hair/${hairStyle}/adult/bg/walk/${mappedHairColor}.png`, optional: true },
                { name: 'hair_fg', url: `/spritesheets/hair/${hairStyle}/adult/fg/walk.png`, optional: true }
            );
        } else {
            // Regular hair styles just have one layer
            layerConfigs.push(
                { name: 'hair', url: `/spritesheets/hair/${hairStyle}/adult/walk/${mappedHairColor}.png`, optional: true }
            );
        }
        
        // Load each layer
        for (const config of layerConfigs) {
            await this.loadLayer(config.name, config.url, config.optional);
        }
        
        this.createAnimations();
        this.playAnimation('idle', 'down');
    }
    
    async loadLayer(layerName, url, optional = false) {
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
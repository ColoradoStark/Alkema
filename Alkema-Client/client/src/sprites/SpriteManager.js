export class SpriteManager {
    constructor(scene) {
        this.scene = scene;
        this.cache = new Map();
        this.apiBaseUrl = 'http://localhost:8000';
        this.pendingLoads = new Map();
    }

    async getCharacterSprite(characterData) {
        const cacheKey = this.generateCacheKey(characterData);
        
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }
        
        if (this.pendingLoads.has(cacheKey)) {
            return this.pendingLoads.get(cacheKey);
        }
        
        const loadPromise = this.loadCharacterSprite(characterData, cacheKey);
        this.pendingLoads.set(cacheKey, loadPromise);
        
        try {
            const result = await loadPromise;
            this.pendingLoads.delete(cacheKey);
            return result;
        } catch (error) {
            this.pendingLoads.delete(cacheKey);
            throw error;
        }
    }

    async loadCharacterSprite(characterData, cacheKey) {
        try {
            // Build the request body for the new API format
            const selections = [
                { type: "body", item: "body", variant: characterData.skin_color || "light" },
                { type: "head", item: `heads_human_${characterData.body_type || 'male'}` }
            ];
            
            // Add hair if specified
            if (characterData.hair_style) {
                selections.push({
                    type: "hair",
                    item: `hair_${characterData.hair_style}`,
                    variant: characterData.hair_color || "brown"
                });
            }
            
            // Add basic clothing
            selections.push(
                { type: "legs", item: "legs_pants", variant: "teal" },
                { type: "torso", item: "torso_shirt", variant: "white" }
            );
            
            const requestBody = {
                body_type: characterData.body_type || 'male',
                selections: selections
            };
            
            // Generate sprite using POST request
            const response = await fetch(`${this.apiBaseUrl}/generate-sprite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                throw new Error(`Failed to generate sprite: ${response.status}`);
            }
            
            const blob = await response.blob();
            const spriteUrl = URL.createObjectURL(blob);
            
            return new Promise((resolve, reject) => {
                this.scene.load.spritesheet(characterData.id || cacheKey, spriteUrl, {
                    frameWidth: 64,
                    frameHeight: 64
                });
                
                this.scene.load.once('complete', () => {
                    this.cache.set(cacheKey, spriteUrl);
                    resolve(spriteUrl);
                });
                
                this.scene.load.once('loaderror', () => {
                    reject(new Error('Failed to load sprite'));
                });
                
                this.scene.load.start();
            });
        } catch (error) {
            console.error('Error loading character sprite:', error);
            throw error;
        }
    }

    generateCacheKey(characterData) {
        const bodyType = characterData.body_type || 'male';
        const skinColor = characterData.skin_color || 'light';
        const hairStyle = characterData.hair_style || 'plain';
        const hairColor = characterData.hair_color || 'brown';
        
        const base = `${bodyType}_${skinColor}_${hairStyle}_${hairColor}`;
        
        if (characterData.equipment && Object.keys(characterData.equipment).length > 0) {
            const equipmentKeys = Object.entries(characterData.equipment)
                .map(([slot, item]) => `${slot}:${item?.id || 'none'}`)
                .join('_');
            return `${base}_${equipmentKeys}`;
        }
        
        return base;
    }

    async getAvailableParameters() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/available-parameters`);
            return await response.json();
        } catch (error) {
            console.error('Failed to fetch available parameters:', error);
            return null;
        }
    }

    clearCache() {
        this.cache.clear();
    }

    removeFromCache(cacheKey) {
        this.cache.delete(cacheKey);
    }
}
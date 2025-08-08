import axios from 'axios';

export class AssetManager {
    constructor() {
        this.apiUrl = process.env.API_URL || 'http://api-character-sprite-generator:8000';
        this.assetCache = null;
        this.lastCacheTime = 0;
        this.cacheTimeout = 60000; // 1 minute cache
        
        // Valid combinations discovered from the API
        this.validAssets = {
            male: {
                bodies: [],
                hair: [],
                clothes: [],
                accessories: []
            },
            female: {
                bodies: [],
                hair: [],
                clothes: [],
                accessories: []
            }
        };
    }
    
    async getAvailableAssets() {
        // Return cached data if still valid
        if (this.assetCache && (Date.now() - this.lastCacheTime) < this.cacheTimeout) {
            return this.assetCache;
        }
        
        try {
            console.log('AssetManager: Fetching available assets from API...');
            const response = await axios.get(`${this.apiUrl}/available-assets`);
            
            if (response.data) {
                this.assetCache = response.data;
                this.lastCacheTime = Date.now();
                console.log('AssetManager: Successfully fetched assets from API');
                return this.assetCache;
            }
        } catch (error) {
            console.error('AssetManager: Failed to fetch assets:', error.message);
            // Return default fallback assets
            this.assetCache = this._getDefaultAssets();
            return this.assetCache;
        }
    }
    
    _processAssets(assets) {
        // Process the raw asset data into usable categories
        for (const [category, items] of Object.entries(assets)) {
            if (category === 'hair') {
                // Hair items that work for both genders
                this.validAssets.male.hair = items.filter(item => 
                    !item.female_only
                ).map(item => ({
                    style: item.name,
                    colors: item.variants || ['blonde', 'brown', 'black']
                }));
                
                this.validAssets.female.hair = items.map(item => ({
                    style: item.name,
                    colors: item.variants || ['blonde', 'brown', 'black']
                }));
            } else if (category === 'torso') {
                // Clothes that work for each gender
                const maleClothes = items.filter(item => 
                    item.body_types?.includes('male') || 
                    item.fit_all_body_types
                );
                
                const femaleClothes = items.filter(item => 
                    item.body_types?.includes('female') || 
                    item.fit_all_body_types
                );
                
                this.validAssets.male.clothes = maleClothes.map(item => ({
                    type: item.name,
                    colors: item.variants || ['brown', 'blue', 'green']
                }));
                
                this.validAssets.female.clothes = femaleClothes.map(item => ({
                    type: item.name,
                    colors: item.variants || ['brown', 'blue', 'green']
                }));
            }
        }
    }
    
    _getDefaultAssets() {
        // Fallback assets that we know work
        return {
            male: {
                bodies: [
                    { type: 'human', skin_colors: ['light', 'amber', 'olive', 'brown', 'black'] }
                ],
                hair: [
                    { style: 'plain', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] },
                    { style: 'bedhead', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] },
                    { style: 'buzzcut', colors: ['blonde', 'brown', 'black', 'gray', 'white'] },
                    { style: 'messy1', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] },
                    { style: 'spiked', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] }
                ],
                clothes: [
                    { type: 'vest', colors: ['brown', 'blue', 'green', 'red', 'black', 'white', 'purple'] },
                    { type: 'longsleeve', colors: ['brown', 'blue', 'green', 'red', 'black', 'white'] }
                ],
                pants: [
                    { type: 'pants', colors: ['brown', 'black', 'blue', 'gray', 'tan'] }
                ]
            },
            female: {
                bodies: [
                    { type: 'human', skin_colors: ['light', 'amber', 'olive', 'brown', 'black'] }
                ],
                hair: [
                    { style: 'plain', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] },
                    { style: 'loose', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] },
                    { style: 'ponytail', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] },
                    { style: 'princess', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] },
                    { style: 'pixie', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] },
                    { style: 'long', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] },
                    { style: 'bob', colors: ['blonde', 'brown', 'black', 'gray', 'white', 'red'] }
                ],
                clothes: [
                    { type: 'tunic', colors: ['brown', 'blue', 'green', 'red', 'black', 'white', 'purple', 'pink'] },
                    { type: 'longsleeve', colors: ['brown', 'blue', 'green', 'red', 'black', 'white', 'pink'] }
                ],
                pants: [
                    { type: 'pants', colors: ['brown', 'black', 'blue', 'gray', 'tan'] }
                ]
            }
        };
    }
    
    async getRandomCharacter(bodyType = null) {
        // Get assets from cache or API
        const assets = this.assetCache || await this.getAvailableAssets();
        
        // Random body type if not specified
        if (!bodyType) {
            bodyType = Math.random() < 0.5 ? 'male' : 'female';
        }
        
        const typeAssets = assets[bodyType];
        if (!typeAssets) {
            console.error('AssetManager: No assets found for body type:', bodyType);
            return this._getFallbackCharacter(bodyType);
        }
        
        // Select random elements from each category
        const skinColor = this._randomChoice(typeAssets.skin_colors || ['light']);
        
        const hairData = this._randomChoice(typeAssets.hair_styles || []);
        const hairStyle = hairData.name || 'plain';
        const hairColor = this._randomChoice(hairData.variants || ['brown']);
        
        const shirtData = this._randomChoice(typeAssets.shirt_types || []);
        const shirtType = shirtData.name || (bodyType === 'female' ? 'tunic' : 'vest');
        const shirtColor = this._randomChoice(shirtData.variants || ['blue']);
        
        const pantsColor = this._randomChoice(typeAssets.pants_colors || ['brown']);
        
        console.log(`AssetManager: Generated ${bodyType} character:`, {
            hairStyle, hairColor, shirtType, shirtColor, pantsColor
        });
        
        return {
            body_type: bodyType,
            skin_color: skinColor,
            hair_style: hairStyle,
            hair_color: hairColor,
            shirt_type: shirtType,
            shirt_color: shirtColor,
            pants_color: pantsColor
        };
    }
    
    _getFallbackCharacter(bodyType) {
        // Minimal fallback character that should always work
        return {
            body_type: bodyType,
            skin_color: 'light',
            hair_style: 'plain',
            hair_color: 'brown',
            shirt_type: bodyType === 'female' ? 'tunic' : 'vest',
            shirt_color: 'blue',
            pants_color: 'brown'
        };
    }
    
    _randomChoice(array) {
        return array[Math.floor(Math.random() * array.length)];
    }
}
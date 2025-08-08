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
        
        // Get hair style - for females, prefer longer styles
        let hairData;
        if (bodyType === 'female' && typeAssets.hair_styles) {
            hairData = this._getWeightedFemaleHairStyle(typeAssets.hair_styles);
        } else {
            hairData = this._randomChoice(typeAssets.hair_styles || []);
        }
        const hairStyle = hairData.name || 'plain';
        const hairColor = this._getContrastingColor(
            skinColor, 
            hairData.variants || ['brown'],
            'hair'
        );
        
        // Get shirt color that contrasts with skin
        const shirtData = this._randomChoice(typeAssets.shirt_types || []);
        const shirtType = shirtData.name || (bodyType === 'female' ? 'tunic' : 'vest');
        const shirtColor = this._getContrastingColor(
            skinColor,
            shirtData.variants || ['blue'],
            'shirt'
        );
        
        // Get pants color that also contrasts with skin
        const pantsColor = this._getContrastingColor(
            skinColor,
            typeAssets.pants_colors || ['brown', 'black', 'blue', 'gray', 'tan'],
            'pants'
        );
        
        console.log(`AssetManager: Generated ${bodyType} character:`, {
            skinColor, hairStyle, hairColor, shirtType, shirtColor, pantsColor
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
    
    _getContrastingColor(skinColor, availableColors, itemType) {
        // Define which colors are too similar to each skin tone
        // Note: Available hair colors are: blonde, dark_brown, black, gray, white, red
        // Being VERY conservative - exclude any colors that might not provide clear contrast
        const conflictMap = {
            'light': {
                hair: ['white', 'blonde'], // Light colors can blend with light skin
                shirt: ['white', 'pink', 'tan', 'gray', 'red', 'brown'], // Light/warm colors can blend
                pants: ['tan', 'gray'] // Light neutrals can blend
            },
            'amber': {
                hair: [], // All hair colors contrast well with amber
                shirt: ['tan', 'brown', 'gray', 'red'], // Warm/neutral colors blend with amber
                pants: ['tan', 'brown'] // Warm colors can blend
            },
            'olive': {
                hair: [], // All hair colors contrast well with olive  
                shirt: ['green', 'olive', 'gray', 'brown'], // Earth tones blend with olive
                pants: ['gray', 'green'] // Neutral/earth tones can blend
            },
            'brown': {
                hair: [], // All hair colors actually contrast OK with brown skin
                shirt: ['brown', 'tan', 'gray', 'red'], // Browns and warm colors blend
                pants: ['brown', 'tan'] // Brown tones can blend
            },
            'black': {
                hair: ['black'], // Only pure black blends
                shirt: ['black', 'gray', 'white', 'purple'], // Dark colors and some light colors
                pants: ['black', 'gray'] // Dark colors can blend
            }
        };
        
        // Get conflicts for this skin color and item type
        const conflicts = conflictMap[skinColor]?.[itemType] || [];
        
        // Filter out conflicting colors
        let safeColors = availableColors.filter(color => {
            // Check if this color conflicts with skin
            const colorName = color.toLowerCase().replace('_', ' ');
            return !conflicts.some(conflict => 
                colorName.includes(conflict) || conflict.includes(colorName)
            );
        });
        
        // If no safe colors remain, use defaults that always contrast
        if (safeColors.length === 0) {
            console.log(`AssetManager: No contrasting ${itemType} colors for ${skinColor} skin, using defaults`);
            if (itemType === 'hair') {
                // Default contrasting hair colors for each skin tone
                const defaults = {
                    'light': ['black', 'dark_brown', 'red'],
                    'amber': ['black', 'dark_brown', 'white'],
                    'olive': ['black', 'blonde', 'red', 'white'],
                    'brown': ['black', 'blonde', 'gray', 'white'],
                    'black': ['blonde', 'gray', 'white', 'red']
                };
                safeColors = defaults[skinColor] || ['black'];
            } else if (itemType === 'pants') {
                // Default contrasting pants colors for each skin tone
                const defaults = {
                    'light': ['black', 'blue', 'brown'],  // Dark colors contrast well
                    'amber': ['black', 'blue', 'gray'],   // Cool colors contrast
                    'olive': ['black', 'blue', 'brown'],  // Dark colors work
                    'brown': ['black', 'blue', 'gray'],   // Cool/dark colors
                    'black': ['blue', 'tan', 'brown']     // Medium/light colors
                };
                safeColors = defaults[skinColor] || ['black'];
            } else {
                // Default contrasting shirt colors for each skin tone  
                // Using only high-contrast colors that work well
                const defaults = {
                    'light': ['blue', 'green', 'black', 'purple'],  // Removed red
                    'amber': ['blue', 'green', 'black', 'purple'],   // Removed red
                    'olive': ['blue', 'red', 'black', 'purple', 'pink'],
                    'brown': ['blue', 'green', 'purple', 'pink', 'black'],  // Removed red
                    'black': ['blue', 'green', 'red', 'teal', 'pink']
                };
                safeColors = defaults[skinColor] || ['blue'];
            }
            
            // Find first available default color
            const available = safeColors.find(c => 
                availableColors.some(ac => ac.toLowerCase() === c.toLowerCase())
            );
            if (available) {
                return available;
            }
        }
        
        // Return random choice from safe colors
        const chosen = this._randomChoice(safeColors);
        console.log(`AssetManager: Chose ${itemType} color '${chosen}' for ${skinColor} skin (avoided: ${conflicts.join(', ') || 'none'})`);
        return chosen;
    }
    
    _getWeightedFemaleHairStyle(hairStyles) {
        // Define short and long hair styles
        const shortStyles = ['pixie', 'bob', 'plain'];
        const longStyles = ['loose', 'ponytail', 'princess', 'long', 'shoulderl'];
        
        // Separate styles into short and long
        const shortOptions = hairStyles.filter(h => shortStyles.includes(h.name));
        const longOptions = hairStyles.filter(h => longStyles.includes(h.name));
        
        // 85% chance for long hair, 15% for short
        if (Math.random() < 0.85 && longOptions.length > 0) {
            return this._randomChoice(longOptions);
        } else if (shortOptions.length > 0) {
            return this._randomChoice(shortOptions);
        } else {
            // Fallback to any available style
            return this._randomChoice(hairStyles);
        }
    }
    
    _randomChoice(array) {
        return array[Math.floor(Math.random() * array.length)];
    }
}
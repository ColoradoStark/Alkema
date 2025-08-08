export class NameGenerator {
    constructor() {
        // Pronounceable first name components
        this.firstNamePrefixes = [
            'Al', 'Ar', 'Bran', 'Cael', 'Dar', 'El', 'Finn', 'Gar', 'Hal', 'Ian',
            'Kai', 'Lor', 'Mar', 'Nor', 'Or', 'Rae', 'Sar', 'Thal', 'Val', 'Wyn',
            'Bri', 'Cor', 'Dun', 'Ev', 'Gwen', 'Lir', 'Mer', 'Nia', 'Rhi', 'Syl'
        ];
        
        this.firstNameSuffixes = [
            'an', 'en', 'in', 'on', 'un', 'ar', 'er', 'ir', 'or', 'ur',
            'el', 'al', 'il', 'ol', 'iel', 'ael', 'wyn', 'ric', 'dan', 'lin',
            'ara', 'ena', 'ina', 'ona', 'ana', 'ella', 'enna', 'issa', 'ora', 'ira'
        ];
        
        // English surnames - common fantasy/medieval style
        this.englishSurnames = [
            'Smith', 'Fletcher', 'Cooper', 'Miller', 'Baker', 'Hunter', 'Fisher',
            'Archer', 'Shepherd', 'Mason', 'Turner', 'Walker', 'Wright', 'Carter',
            'Porter', 'Weaver', 'Taylor', 'Thatcher', 'Sawyer', 'Carpenter',
            'Stone', 'Wood', 'Hill', 'Brook', 'Field', 'Lake', 'River', 'Forest',
            'Frost', 'Storm', 'Wind', 'Snow', 'Summer', 'Winter', 'Spring',
            'Black', 'White', 'Grey', 'Brown', 'Green', 'Gold', 'Silver',
            'Strong', 'Swift', 'Bright', 'Sharp', 'Wise', 'Bold', 'Young'
        ];
        
        // Gaelic-inspired surname prefixes and patterns
        this.gaelicPrefixes = [
            'Mac', 'Mc', 'O\'', 'Fitz'
        ];
        
        // Gaelic surname roots (without prefix)
        this.gaelicRoots = [
            'Aodh', 'Bran', 'Cath', 'Donn', 'Finn', 'Gall', 'Niall', 'Ruadh',
            'Dubh', 'Glas', 'Mor', 'Beag', 'Ard', 'Ban', 'Coill', 'Loch'
        ];
        
        // Traditional standalone Gaelic surnames
        this.standaloneGaelicSurnames = [
            'Brennan', 'Byrne', 'Campbell', 'Connolly', 'Doherty', 'Donnelly',
            'Finnegan', 'Gallagher', 'Kelly', 'Murphy', 'Quinn', 'Ryan',
            'Sullivan', 'Walsh', 'Flanagan', 'Kearney', 'Maguire', 'Nolan'
        ];
    }
    
    generateFirstName(isFemale = null) {
        const prefix = this._randomChoice(this.firstNamePrefixes);
        const suffix = this._randomChoice(this.firstNameSuffixes);
        
        // Ensure name doesn't have repeated syllables
        let name = prefix + suffix;
        
        // Capitalize first letter
        name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        
        // Ensure reasonable length (3-8 characters)
        if (name.length < 3) {
            name += this._randomChoice(['n', 'l', 'r', 's']);
        } else if (name.length > 8) {
            name = name.substring(0, 8);
        }
        
        // Ensure female names end with vowel, male names with consonant
        const lastChar = name[name.length - 1].toLowerCase();
        const vowels = ['a', 'e', 'i', 'o', 'u'];
        const isVowel = vowels.includes(lastChar);
        
        if (isFemale === true && !isVowel) {
            // Female name should end with vowel
            name += this._randomChoice(['a', 'e', 'i']);
        } else if (isFemale === false && isVowel) {
            // Male name should end with consonant
            name += this._randomChoice(['n', 'r', 's', 't', 'l']);
        }
        
        return name;
    }
    
    generateEnglishSurname() {
        return this._randomChoice(this.englishSurnames);
    }
    
    generateGaelicSurname() {
        const roll = Math.random();
        
        if (roll < 0.5) {
            // 50% chance: Use a traditional standalone surname
            return this._randomChoice(this.standaloneGaelicSurnames);
        } else {
            // 50% chance: Use Mac/Mc/O' prefix with root
            const prefix = this._randomChoice(this.gaelicPrefixes);
            const root = this._randomChoice(this.gaelicRoots);
            
            // Mac and Mc need no space, O' already has apostrophe
            return prefix + root;
        }
    }
    
    generateFullName(skinColor = null, bodyType = null) {
        const isFemale = bodyType === 'female';
        const firstName = this.generateFirstName(isFemale);
        
        // 20% chance of Gaelic surname only for light-skinned characters
        let lastName;
        if (skinColor === 'light' && Math.random() < 0.2) {
            lastName = this.generateGaelicSurname();
        } else {
            lastName = this.generateEnglishSurname();
        }
        
        return `${firstName} ${lastName}`;
    }
    
    _randomChoice(array) {
        return array[Math.floor(Math.random() * array.length)];
    }
}

// Export singleton instance
export const nameGenerator = new NameGenerator();
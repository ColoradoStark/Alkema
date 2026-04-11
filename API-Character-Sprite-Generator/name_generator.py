"""Fantasy name generator for character creation."""

import random

FIRST_NAME_PREFIXES = [
    'Al', 'Ar', 'Bran', 'Cael', 'Dar', 'El', 'Finn', 'Gar', 'Hal', 'Ian',
    'Kai', 'Lor', 'Mar', 'Nor', 'Or', 'Rae', 'Sar', 'Thal', 'Val', 'Wyn',
    'Bri', 'Cor', 'Dun', 'Ev', 'Gwen', 'Lir', 'Mer', 'Nia', 'Rhi', 'Syl',
]

FIRST_NAME_SUFFIXES = [
    'an', 'en', 'in', 'on', 'un', 'ar', 'er', 'ir', 'or', 'ur',
    'el', 'al', 'il', 'ol', 'iel', 'ael', 'wyn', 'ric', 'dan', 'lin',
    'ara', 'ena', 'ina', 'ona', 'ana', 'ella', 'enna', 'issa', 'ora', 'ira',
]

ENGLISH_SURNAMES = [
    'Smith', 'Fletcher', 'Cooper', 'Miller', 'Baker', 'Hunter', 'Fisher',
    'Archer', 'Shepherd', 'Mason', 'Turner', 'Walker', 'Wright', 'Carter',
    'Porter', 'Weaver', 'Taylor', 'Thatcher', 'Sawyer', 'Carpenter',
    'Stone', 'Wood', 'Hill', 'Brook', 'Field', 'Lake', 'River', 'Forest',
    'Frost', 'Storm', 'Wind', 'Snow', 'Summer', 'Winter', 'Spring',
    'Black', 'White', 'Grey', 'Brown', 'Green', 'Gold', 'Silver',
    'Strong', 'Swift', 'Bright', 'Sharp', 'Wise', 'Bold', 'Young',
]

GAELIC_PREFIXES = ['Mac', 'Mc', "O'", 'Fitz']

GAELIC_ROOTS = [
    'Aodh', 'Bran', 'Cath', 'Donn', 'Finn', 'Gall', 'Niall', 'Ruadh',
    'Dubh', 'Glas', 'Mor', 'Beag', 'Ard', 'Ban', 'Coill', 'Loch',
]

STANDALONE_GAELIC_SURNAMES = [
    'Brennan', 'Byrne', 'Campbell', 'Connolly', 'Doherty', 'Donnelly',
    'Finnegan', 'Gallagher', 'Kelly', 'Murphy', 'Quinn', 'Ryan',
    'Sullivan', 'Walsh', 'Flanagan', 'Kearney', 'Maguire', 'Nolan',
]

VOWELS = set('aeiou')
_FEMALE_BODY_TYPES = {'female', 'pregnant'}


def _generate_first_name(is_female: bool) -> str:
    prefix = random.choice(FIRST_NAME_PREFIXES)
    suffix = random.choice(FIRST_NAME_SUFFIXES)
    name = (prefix + suffix).capitalize()

    # Clamp to 3-8 characters
    if len(name) < 3:
        name += random.choice(['n', 'l', 'r', 's'])
    elif len(name) > 8:
        name = name[:8]

    # Female names end with vowel, male names with consonant
    last = name[-1].lower()
    if is_female and last not in VOWELS:
        name += random.choice(['a', 'e', 'i'])
    elif not is_female and last in VOWELS:
        name += random.choice(['n', 'r', 's', 't', 'l'])

    return name


def _generate_surname() -> str:
    if random.random() < 0.2:
        # 20% Gaelic surname
        if random.random() < 0.5:
            return random.choice(STANDALONE_GAELIC_SURNAMES)
        else:
            return random.choice(GAELIC_PREFIXES) + random.choice(GAELIC_ROOTS)
    return random.choice(ENGLISH_SURNAMES)


def generate_full_name(body_type: str) -> str:
    """Generate a fantasy full name based on body type gender."""
    is_female = body_type in _FEMALE_BODY_TYPES
    first = _generate_first_name(is_female)
    last = _generate_surname()
    return f"{first} {last}"

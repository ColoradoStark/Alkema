// Tiny hand-drawn pixel icons (12×12) for UI controls, rendered as crisp SVG.
// Colours are from the DawnBringer-32 palette the Golden UI art uses.

const PALETTE = {
    o: '#222034', // ink outline / pips
    c: '#ffffff', // lit face
    m: '#cbdbfc', // left face
    s: '#9badb7', // right face
    l: '#eec39a', // parchment strokes / bare wood
    y: '#dad45e', // pencil paint
    p: '#d77bba', // eraser
    d: '#847e87', // die edge, readable on dark and light backgrounds
    r: '#ac3232', // paint
    g: '#6abe30', // paint
    b: '#639bff', // paint
};

const ICONS = {
    // Bold clockwise arrow
    turnRight: [
        '...lllll....',
        '..ll...ll...',
        '.ll.....ll..',
        'll.......ll.',
        'll.....lllll',
        'll......lll.',
        'll.......l..',
        'll..........',
        '.ll.........',
        '..ll.....ll.',
        '...lllllll..',
        '....lllll...',
    ],
    // Isometric die: lit top with one pip, two pips per side; faces are
    // separated by shading only, so it reads on the dark banner too.
    dice: [
        '....dddd....',
        '..ddccccdd..',
        'dccccooccccd',
        'dmmccccccssd',
        'dmmmmccssssd',
        'dmmmmmsssssd',
        'dmommmsssosd',
        'dmmmmmsssssd',
        'dmmmomsosssd',
        'dmmmmmsssssd',
        '..ddmmssdd..',
        '....dddd....',
    ],
    // Account placeholder
    user: [
        '............',
        '....oooo....',
        '...ollllo...',
        '...ollllo...',
        '...ollllo...',
        '....oooo....',
        '..oolllloo..',
        '.ollllllllo.',
        '.ollllllllo.',
        '.ollllllllo.',
        '.oooooooooo.',
        '............',
    ],
    // Artist's palette with paint dabs, for "Customize look"
    palette: [
        '..oooooooo..',
        '.ollllllllo.',
        'olrrllbbllo.',
        'olrrllbblllo',
        'ollllllllggo',
        'oyyllllllggo',
        'oyylloolllo.',
        'ollo..olllo.',
        '.oo...ollo..',
        '.......oo...',
        '............',
        '............',
    ],
    // Sound setting: speaker with two waves (all on), one wave (effects only), a red X (off)
    soundAll: [
        '............',
        '....o.......',
        '...ol...l...',
        '..oll.l..l..',
        'ooll...l..l.',
        'olll...l..l.',
        'olll...l..l.',
        'ooll...l..l.',
        '..oll.l..l..',
        '...ol...l...',
        '....o.......',
        '............',
    ],
    soundSfx: [
        '............',
        '....o.......',
        '...ol.......',
        '..oll.l.....',
        'ooll...l....',
        'olll...l....',
        'olll...l....',
        'ooll...l....',
        '..oll.l.....',
        '...ol.......',
        '....o.......',
        '............',
    ],
    soundOff: [
        '............',
        '....o.......',
        '...ol.......',
        '..oll.r...r.',
        'ooll...r.r..',
        'olll....r...',
        'olll...r.r..',
        'ooll..r...r.',
        '..oll.......',
        '...ol.......',
        '....o.......',
        '............',
    ],
    // Pencil, eraser at top right, point at bottom left.
    pencil: [
        '.........oo.',
        '........oppo',
        '.......ommo.',
        '......oymo..',
        '.....oyyo...',
        '....oyyo....',
        '...oyyo.....',
        '..oyyo......',
        '.olyo.......',
        '.olo........',
        'oo..........',
        'o...........',
    ],
};


/** Inline SVG markup for an icon, drawn at `size` CSS px. */
export function pixelIcon(name, size = 24) {
    const rows = ICONS[name];
    if (!rows) return '';
    const rects = [];
    rows.forEach((row, y) => {
        [...row].forEach((ch, x) => {
            const fill = PALETTE[ch];
            if (fill) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
        });
    });
    return `<svg class="px-icon" width="${size}" height="${size}" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${rects.join('')}</svg>`;
}

/** The same icon as a Phaser texture (1 texel per pixel; scale it up in the scene). */
export function pixelIconTexture(scene, name, key = `px-${name}`) {
    if (scene.textures.exists(key)) return key;
    const rows = ICONS[name];
    const canvas = scene.textures.createCanvas(key, 12, 12);
    const ctx = canvas.getContext();
    rows.forEach((row, y) => {
        [...row].forEach((ch, x) => {
            if (!PALETTE[ch]) return;
            ctx.fillStyle = PALETTE[ch];
            ctx.fillRect(x, y, 1, 1);
        });
    });
    canvas.refresh();
    return key;
}

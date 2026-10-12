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

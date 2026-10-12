// Leather panel background shared by the top bar and bottom controls, matching
// the character creator: a brown base, the creator's dithered leather tiled at
// 2×, and a thin gold border on top.

const LEATHER = 0x3d2510;
const GOLD = 0xc8a04a;

/** Add the panel background to `container` (in its local coordinates). */
export function addPanelBackground(scene, container, x, width, height) {
    const base = scene.add.graphics();
    base.fillStyle(LEATHER, 1);
    base.fillRect(x, 0, width, height);
    container.add(base);

    if (scene.textures.exists('ui-leather')) {
        const tiles = scene.add.tileSprite(x, 0, width, height, 'ui-leather').setOrigin(0, 0).setTileScale(2);
        container.add(tiles);
    }

    const border = scene.add.graphics();
    border.lineStyle(1, GOLD, 1);
    border.strokeRect(x + 0.5, 0.5, width - 1, height - 1);
    container.add(border);
}

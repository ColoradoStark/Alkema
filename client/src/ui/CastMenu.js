// "Cast which spell?" In a fight the blue button opens this over the battle
// map: the hero's six spells (a fighter's or thief's battle skills), each at
// the highest rank they know. Those they can cast now are bright; one short
// of magic or still resting says so; one still to learn is greyed with the
// level it comes at. Tap one to cast it (as the turn), or Cancel.

const W = 300;
const ROW = 46;
const ICON = 36;
const TOP = 32, VIEW_H = 448;

export class CastMenu {
    /**
     * @param {Phaser.Scene} scene  the UI scene
     * @param {{ onPick: (id: string) => void }} opts
     */
    constructor(scene, { onPick }) {
        this.scene = scene;
        this.onPick = onPick;
        this.container = scene.add.container(0, 0).setDepth(70).setVisible(false);
        this.visible = false;
    }

    /** Show the hero's spells, as they stand in this fight. */
    open(book, battle) {
        const s = this.scene;
        this.container.removeAll(true);
        const list = book.list;
        const h = 40 + list.length * ROW + 44;
        const x0 = Math.round((s.scale.width - W) / 2), y0 = TOP + Math.round((VIEW_H - h) / 2);
        // A shade over the field, and the panel
        const shade = s.add.rectangle(0, TOP, s.scale.width, VIEW_H, 0x110d1a, 0.55).setOrigin(0, 0).setInteractive();
        shade.on('pointerdown', () => this.close());
        const panel = s.add.graphics();
        panel.fillStyle(0x291709, 0.96).fillRoundedRect(x0, y0, W, h, 6);
        panel.lineStyle(2, 0xc8a04a, 1).strokeRoundedRect(x0, y0, W, h, 6);
        const title = s.add.text(x0 + W / 2, y0 + 12, book.magic ? 'Cast which spell?' : 'Use which skill?', {
            fontFamily: 'Alagard, monospace', fontSize: '16px', color: '#fbf236',
        }).setOrigin(0.5, 0);
        this.container.add([shade, panel, title]);

        const rowsOf = s.cache.json.get('spell-icons-index')?.rows || {};
        list.forEach((spell, i) => {
            const y = y0 + 40 + i * ROW;
            const rank = book.rankOf(spell.id);
            const at = rank ? spell.ranks[rank - 1] : null;
            const why = at ? battle.whyNot(spell, at) : null;       // null: castable now
            const usable = at && !why;
            const bg = s.add.rectangle(x0 + 8, y, W - 16, ROW - 4, usable ? 0x4a3012 : 0x1f1208, 1).setOrigin(0, 0)
                .setStrokeStyle(1, usable ? 0xdab040 : 0x6a4a18);
            const items = [bg];
            if (s.textures.exists('spell-icons') && rowsOf[spell.id] !== undefined) {
                const icon = s.add.image(x0 + 14, y + (ROW - 4) / 2, 'spell-icons', rowsOf[spell.id]).setOrigin(0, 0.5)
                    .setDisplaySize(ICON, ICON);
                if (!usable) icon.setTint(at ? 0x9a9a9a : 0x6a6a6a);
                items.push(icon);
            }
            const name = s.add.text(x0 + 14 + ICON + 10, y + 7, spell.name, {
                fontFamily: 'Alagard, monospace', fontSize: '15px', color: usable ? '#fff6e0' : at ? '#c8b090' : '#7a6650',
            });
            const note = !at ? `Learned at level ${spell.ranks[0].level}`
                : why || [`Rank ${rank}`, at.mp ? `${at.mp} MP` : null, at.wait ? `rests ${at.wait} turns after` : null].filter(Boolean).join(' · ');
            const sub = s.add.text(x0 + 14 + ICON + 10, y + 24, note, {
                fontFamily: 'Romulus, monospace', fontSize: '11px', color: usable ? '#eec39a' : '#8a7058',
            });
            items.push(name, sub);
            bg.setData('spell', spell.id);
            if (usable) {
                bg.setInteractive({ useHandCursor: true });
                bg.on('pointerdown', () => {
                    this.close();
                    this.onPick(spell.id);
                });
            }
            this.container.add(items);
        });

        const cancel = s.add.text(x0 + W / 2, y0 + h - 22, 'Cancel', {
            fontFamily: 'Alagard, monospace', fontSize: '15px', color: '#eec39a',
            backgroundColor: '#3d2510', padding: { x: 14, y: 5 },
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });
        cancel.on('pointerdown', () => this.close());
        this.container.add(cancel);
        this.container.setVisible(true);
        this.visible = true;
    }

    close() {
        if (!this.visible) return;
        this.container.setVisible(false).removeAll(true);
        this.visible = false;
    }
}

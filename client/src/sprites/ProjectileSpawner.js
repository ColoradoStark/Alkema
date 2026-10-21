// Client-side projectile visuals (arrows, rocks).
// Server owns authoritative projectile simulation; this module only renders.

const ARROW_OFFSETS = {
    bow:      { up: { x:  3, y: -32 }, down: { x: -3, y: 12 }, left: { x: 0, y:  3 }, right: { x: 0, y:  3 } },
    crossbow: { up: { x:  6, y: -32 }, down: { x: -6, y: 12 }, left: { x: 0, y: 15 }, right: { x: 0, y: 15 } },
};

const ROCK_OFFSETS = {
    up:    { x:  0, y: -24 },
    down:  { x:  0, y:  16 },
    left:  { x: -16, y:  0 },
    right: { x:  16, y:  0 },
};

export const ARROW_SPEED = 300;
export const ROCK_SPEED = 250;

function velocityFor(direction, speed) {
    const v = {
        up: { x: 0, y: -speed },
        down: { x: 0, y: speed },
        left: { x: -speed, y: 0 },
        right: { x: speed, y: 0 }
    };
    return v[direction] || v.down;
}

/** Fly on (until off screen, or `range` px if given: it struck something). */
function attachMover(scene, sprite, vel, range = Infinity) {
    let flown = 0;
    const update = (time, delta) => {
        sprite.x += vel.x * (delta / 1000);
        sprite.y += vel.y * (delta / 1000);
        flown += Math.hypot(vel.x, vel.y) * (delta / 1000);
        if (flown >= range) {
            sprite.destroy();
            scene.events.off('update', update);
            return;
        }

        const cam = scene.cameras.main;
        const margin = 100;
        if (sprite.x < cam.scrollX - margin || sprite.x > cam.scrollX + cam.width + margin ||
            sprite.y < cam.scrollY - margin || sprite.y > cam.scrollY + cam.height + margin) {
            sprite.destroy();
            scene.events.off('update', update);
        }
    };
    scene.events.on('update', update);
}

export function spawnArrow(scene, originX, originY, direction, weaponType, range) {
    if (!scene.textures.exists('arrow-projectile')) return;

    // Use left/right arrow rows and rotate for up/down
    const row = (direction === 'left' || direction === 'up') ? 1 : 3;
    const startFrame = row * 13;
    const frame = startFrame + 5;

    const offsets = ARROW_OFFSETS[weaponType] || ARROW_OFFSETS.bow;
    const { x: offsetX, y: offsetY } = offsets[direction] || { x: 0, y: 0 };

    const arrow = scene.add.sprite(originX + offsetX, originY + offsetY, 'arrow-projectile', frame);
    arrow.setDepth(25);
    if (direction === 'up' || direction === 'down') arrow.setRotation(Math.PI / 2);

    attachMover(scene, arrow, velocityFor(direction, ARROW_SPEED), range);
}

export function spawnRock(scene, originX, originY, direction, range) {
    if (!scene.textures.exists('rock-projectile')) return;

    const { x: offsetX, y: offsetY } = ROCK_OFFSETS[direction] || { x: 0, y: 0 };

    const rock = scene.add.sprite(originX + offsetX, originY + offsetY, 'rock-projectile');
    rock.setScale(0.5);
    rock.setDepth(25);

    attachMover(scene, rock, velocityFor(direction, ROCK_SPEED), range);
}

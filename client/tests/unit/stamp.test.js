// The built files' times are their contents' (client/stamp.mjs, run in the Dockerfile): nginx tells a browser a file is
// unchanged by its time and size, and every deploy builds afresh, so with the build's own times every phone fetched the
// whole world again after each one (the user's: Play got slow, with many deploys a day).
import { describe, test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stamp } from '../../stamp.mjs';

const build = (files, when) => {
    const dir = mkdtempSync(join(tmpdir(), 'stamp-'));
    for (const [name, text] of Object.entries(files)) {
        mkdirSync(join(dir, name, '..'), { recursive: true });
        writeFileSync(join(dir, name), text);
        utimesSync(join(dir, name), when, when);
    }
    stamp(dir);
    return (name) => statSync(join(dir, name)).mtimeMs;
};

describe('Built files keep their time across deploys', () => {
    test('the same file built at another time keeps its time; a changed one gets a new one', () => {
        const a = build({ 'world/overworld.json': '{"n":1}', 'index.html': '<p>a</p>' }, new Date('2026-11-04T10:00:00Z'));
        const b = build({ 'world/overworld.json': '{"n":1}', 'index.html': '<p>b</p>' }, new Date('2026-11-05T12:51:00Z'));
        expect(b('world/overworld.json')).toBe(a('world/overworld.json'));
        expect(b('index.html')).not.toBe(a('index.html'));
        // (never in the future: a time ahead of the clock isn't trusted)
        expect(a('world/overworld.json')).toBeLessThan(Date.now());
    });
});

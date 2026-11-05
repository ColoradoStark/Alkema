// Every built file's time made from what's in it (run on dist in the Dockerfile): nginx tells a browser a file is
// unchanged by its time and size (its ETag and Last-Modified), and each deploy builds afresh, so with the build's own
// times every phone fetched all of the world again after every deploy, ~25 MB (the user's: Play got slow). Now a file
// that hasn't changed keeps its time, and comes back as a 304. tests/unit/stamp.test.js.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

const FROM = Date.UTC(2000, 0, 1) / 1000;
const SPAN = 25 * 365 * 86400;      // a time between 2000 and 2025: never ahead of the clock

export function stamp(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, e.name);
        if (e.isDirectory()) stamp(path);
        else if (e.isFile()) {
            const t = FROM + createHash('sha1').update(readFileSync(path)).digest().readUInt32BE(0) % SPAN;
            utimesSync(path, t, t);
        }
    }
}

if (process.argv[1]?.endsWith('stamp.mjs')) stamp(process.argv[2] || 'dist');

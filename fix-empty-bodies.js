/**
 * fix-empty-bodies.js
 *
 * Problem this addresses: several job-lifecycle transition endpoints send
 * Content-Type: application/json with NO body at all — not even "{}". If
 * the backend controller for any of these declares a @RequestBody (common
 * in Spring Boot even for "no real payload needed" endpoints), that exact
 * combination — JSON content-type, zero bytes — produces a 400 ("Required
 * request body is missing") regardless of whether the path/query IDs are
 * valid. This is a plausible contributing cause for some of the
 * job/quote/handyman-related positive-test failures, separate from the
 * stale-ID issue seed-fixtures.js addresses.
 *
 * What it does: for the exact request items named below, if they currently
 * have no `body` (or an empty one), it adds `{}` as a raw JSON body. Doesn't
 * touch anything else — negative auth-check variants of these same
 * endpoints are untouched on purpose, since those should get rejected by
 * the auth layer before the body would ever matter.
 *
 * This is safe to run even if it turns out these endpoints don't read a
 * body at all — an unread "{}" changes nothing. Run once against the
 * collection (like patch-collection.js), not per test run.
 *
 * Usage: node fix-empty-bodies.js [collectionPath]
 */

const fs = require('fs');

const COLLECTION_PATH = process.argv[2] || 'HandyMan_API_postman_collection.with_negatives.json';

// Exact item names of the positive/happy-path job-transition requests that
// currently send no body. Deliberately an explicit list, not a heuristic —
// so this never accidentally touches a request it shouldn't.
const TARGET_NAMES = new Set([
    'Handyman requests to start the job — awaits client confirmation',
    'Accept a quote and hire Handyman — job moves to QUOTE_ACCEPTED',
    'Handyman confirms the that he has arrived',
    'Client confirms job start — moves to ONGOING',
    "Client confirms the handyman's arrival — unlocks job start",
    'Client confirms job completion',
    'Mark job as completed',
]);

function emptyJsonBody() {
    return {
        mode: 'raw',
        raw: '{}',
        options: { raw: { language: 'json' } },
    };
}

function processItems(items, stats) {
    if (!items || !Array.isArray(items)) return;
    items.forEach(item => {
        if (item.request && TARGET_NAMES.has(item.name)) {
            const req = item.request;
            const currentRaw = req.body && req.body.mode === 'raw' ? String(req.body.raw || '').trim() : '';
            if (!req.body || currentRaw === '') {
                req.body = emptyJsonBody();
                stats.patched++;
                console.log(`[PATCHED] Added empty JSON body: ${item.name}`);
            } else {
                stats.alreadyHadBody++;
                console.log(`[SKIP] Already has a body: ${item.name}`);
            }
        }
        if (item.item) processItems(item.item, stats);
    });
}

try {
    const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));
    const stats = { patched: 0, alreadyHadBody: 0 };

    console.log(`Scanning ${COLLECTION_PATH} for job-transition endpoints missing a body...\n`);
    processItems(collection.item, stats);

    fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2));

    console.log(`\n✅ Done. Patched ${stats.patched} request(s); ${stats.alreadyHadBody} already had a body.`);
    if (stats.patched + stats.alreadyHadBody < TARGET_NAMES.size) {
        console.log(`⚠ Only found ${stats.patched + stats.alreadyHadBody} of ${TARGET_NAMES.size} target requests — check names haven't changed.`);
    }
} catch (error) {
    console.error('✖ Error processing collection:', error.message);
    process.exit(1);
}

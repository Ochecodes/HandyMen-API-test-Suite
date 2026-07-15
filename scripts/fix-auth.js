const fs = require('fs');

const COLLECTION_PATH = process.argv[2] || 'HandyMan_API.postman_collection.json';

try {
    const collectionData = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));

    let scannedCount = 0;
    let strippedCount = 0;
    let fakeTokenCount = 0;
    let correctedCount = 0;

    function processItems(items) {
        if (!items || !Array.isArray(items)) return;

        items.forEach(item => {
            // 1. If it's a request, process its authentication
            if (item.request) {
                scannedCount++;
                const name = (item.name || '').toLowerCase();

                const needsNoAuth = name.includes('without auth') || name.includes('no auth') ||
                                    name.includes('missing token') || name.includes('empty token') ||
                                    name.includes('unauthorized');

                // FIX: previously this matched on "expired" / "invalid" / "wrong" / "bad" / "fake"
                // ANYWHERE in the test name — which also caught tests that have nothing to do
                // with auth, e.g. "...invalid enum value for 'rating'" or "...invalid email format".
                // Those tests got a fake bearer token injected as a side effect, contaminating what
                // they were actually testing. Now the adjective must co-occur with the word "token"
                // in the name, matching how these tests are actually titled
                // (e.g. "...with expired/invalid token is rejected", "...wrong token...", "...bad token...").
                const needsFakeAuth = name.includes('token') && (
                    name.includes('expired') || name.includes('invalid') ||
                    name.includes('wrong') || name.includes('bad') || name.includes('fake')
                );

                if (needsNoAuth) {
                    item.request.auth = { type: "noauth" };
                    strippedCount++;
                    console.log(`[NO AUTH] Fixed: ${item.name}`);
                }
                else if (needsFakeAuth) {
                    item.request.auth = {
                        type: "bearer",
                        bearer: [
                            { key: "token", value: "this_is_a_deliberately_fake_token_12345", type: "string" }
                        ]
                    };
                    fakeTokenCount++;
                    console.log(`[FAKE TOKEN] Fixed: ${item.name}`);
                }
                else if (item.request.auth) {
                    // IMPORTANT: this script must be self-correcting. The previous version's
                    // over-broad matching (bare "invalid"/"expired" with no "token" requirement)
                    // already injected fake tokens into unrelated tests like "...invalid enum
                    // value for 'rating'". Simply not-matching those items on a later run would
                    // leave that bad auth sitting there untouched. So: anything that doesn't
                    // belong to either auth-test category gets its auth field explicitly cleared,
                    // forcing it back to inheriting the collection-level bearer {{authToken}} —
                    // which is what should have happened for it all along.
                    delete item.request.auth;
                    correctedCount++;
                    console.log(`[RESET — was incorrectly tagged before] Fixed: ${item.name}`);
                }
                // Everything else (positive tests, and negative/edge tests that are not about
                // auth at all — wrong data type, missing field, invalid enum, non-existent ID,
                // etc.) inherits the collection-level bearer {{authToken}}, which is now kept
                // fresh by bootstrap-auth.js — see run-tests.js.
            }

            // 2. If it has children (folders), dig deeper (do this independently of the request check)
            if (item.item) {
                processItems(item.item);
            }
        });
    }

    console.log(`Scanning ${COLLECTION_PATH} for auth leaks...\n`);
    processItems(collectionData.item);

    fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collectionData, null, 2));

    console.log(`\n✅ Success! Collection overwritten with secure auth settings.`);
    console.log(`🔍 Total requests scanned: ${scannedCount}`);
    console.log(`➡️ Removed auth from ${strippedCount} requests.`);
    console.log(`➡️ Injected fake tokens into ${fakeTokenCount} requests.`);
    console.log(`➡️ Reset ${correctedCount} incorrectly-tagged requests back to inheriting the collection token.`);

} catch (error) {
    console.error("✖ Error processing collection:", error.message);
}

const newman = require('newman');
const fs = require('fs');
const path = require('path');
const { bootstrapAuth } = require('./bootstrap-auth');
const { seedFixtures } = require('./seed-fixtures');

const resultsDir = path.join(__dirname, 'results');
if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
}

async function main() {
    // Get a verified-fresh token before touching Newman at all. If this
    // fails, we stop here — running the suite against a token we can't
    // vouch for is exactly what made last round's positive-test results
    // impossible to interpret.
    let runtimeEnvPath;
    try {
        runtimeEnvPath = await bootstrapAuth();
    } catch (err) {
        console.error('✖ Could not obtain a fresh auth token, aborting before running any tests:', err.message);
        process.exit(1);
    }

    // Create a real job (and, if a handyman test account is configured,
    // walk the full quote/hire/complete/review lifecycle) so job/quote/
    // handyman/review-related positive tests point at real, current data
    // instead of the old hardcoded "1" placeholders. See seed-fixtures.js
    // for exactly what it can and can't seed without a handyman account.
    try {
        await seedFixtures();
    } catch (err) {
        console.error('✖ Fixture seeding failed:', err.message);
        console.error('  Continuing anyway — job/quote/handyman/review-related positive tests will');
        console.error('  likely fail as a result, but that failure will now be accurately explained.');
    }

    console.log('\n🚀 Starting Newman run...');

    newman.run({
        collection: 'HandyMan_API_postman_collection.with_negatives.json',
        environment: runtimeEnvPath, // freshly-bootstrapped token + seeded fixtures, not the static checked-in file
        iterationData: './data.json',
        reporters: ['cli', 'htmlextra'],
        reporter: {
            htmlextra: {
                export: 'results/newman-report.html'
            }
        }
    }).on('done', function (err, summary) {
        if (err) {
            console.error('Newman run encountered a fatal error:', err);
            process.exit(1);
        }

        console.log('\n🧹 Tests finished! Truncating massive response payloads to prevent V8 string crash...');

        if (summary && summary.run && summary.run.executions) {
            summary.run.executions.forEach(exec => {
                if (exec.response && exec.response.stream) {
                    const bodyText = exec.response.stream.toString();
                    if (bodyText.length > 1500) {
                        exec.response.stream = Buffer.from(
                            bodyText.substring(0, 1500) + '\n\n... [PAYLOAD TRUNCATED BY RUNNER SCRIPT TO PREVENT CRASH] ...'
                        );
                    }
                }
            });
        }

        try {
            const cleanSummary = Object.assign({}, summary);
            delete cleanSummary.exports;

            const exportPath = path.join(resultsDir, 'newman-results.json');
            fs.writeFileSync(exportPath, JSON.stringify(cleanSummary, null, 2));

            console.log(`✅ SUCCESS! Saved safely truncated JSON results to: ${exportPath}`);
        } catch (writeErr) {
            console.error('❌ Failed to save JSON:', writeErr);
        }
    });
}

main();

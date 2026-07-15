/**
 * seed-fixtures.js
 *
 * Problem this solves: jobId, quoteId, handymanId, clientId, and reviewId in
 * the environment file were hardcoded to "1" — leftovers from whichever
 * account was used the first time the suite was ever run. Since
 * bootstrap-auth.js now logs into a fresh/verified CLIENT account every run,
 * those hardcoded IDs usually belong to a *different* account (or don't
 * exist at all), so job/quote/review-related positive tests fail with 400,
 * even though the API itself is behaving correctly.
 *
 * What this script does:
 *   1. Takes the already-bootstrapped CLIENT token (from bootstrap-auth.js's
 *      runtime environment) and creates a REAL job via POST /jobs/create.
 *      This gets you a real jobId + clientId honestly, no faking involved.
 *   2. IMPORTANT LIMITATION: submitting a quote, hiring, starting a job,
 *      notifying arrival, confirming arrival, completing, rating, and
 *      reviewing all require a HANDYMAN to act on the job — not just a
 *      client. There is currently no verified handyman test account, so
 *      this script CANNOT complete that part of the lifecycle on its own.
 *      It says so loudly (see the summary it prints) rather than silently
 *      leaving quoteId/handymanId/reviewId stale and pretending they're fine.
 *   3. If TEST_HANDYMAN_EMAIL / TEST_HANDYMAN_PASSWORD are set (i.e. you've
 *      manually created + OTP-verified one handyman account once, the same
 *      way the original client test account was verified), this script will
 *      automatically walk the full lifecycle and seed quoteId, handymanId,
 *      and reviewId for real too. Until then, those three stay as they are
 *      and the relevant tests will keep failing — correctly, because the
 *      environment genuinely can't exercise those endpoints yet.
 *
 * Usage:
 *   node seed-fixtures.js [runtimeEnvPath] [dataPath]
 *
 * Must run AFTER bootstrap-auth.js, against the SAME runtime environment
 * file it produced (it needs that authToken + userId).
 */

const fs = require('fs');

const ENV_PATH = process.argv[2] || 'HandyMan_Staging.postman_environment.runtime.json';
const DATA_PATH = process.argv[3] || 'data.json';

function loadEnv(envPath) {
    const raw = JSON.parse(fs.readFileSync(envPath, 'utf8'));
    const map = {};
    raw.values.forEach(v => { map[v.key] = v.value; });
    return { raw, map };
}

function setEnvValue(raw, key, value) {
    const entry = raw.values.find(v => v.key === key);
    if (entry) {
        entry.value = String(value);
    } else {
        raw.values.push({ key, value: String(value), enabled: true });
    }
}

async function callApi(baseUrl, method, path, token, body) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* non-JSON or empty body */ }
    return { status: res.status, ok: res.ok, body: json };
}

function extractToken(body) {
    if (!body) return null;
    const candidates = [
        body.token, body.accessToken, body.jwt,
        body.data && body.data.token,
        body.data && body.data.accessToken,
        body.data && body.data.jwt,
    ];
    return candidates.find(v => typeof v === 'string' && v.length > 10) || null;
}

// Response shapes vary — check the common places an id could live.
function extractField(body, ...names) {
    if (!body) return null;
    const sources = [body, body.data];
    for (const src of sources) {
        if (!src) continue;
        for (const n of names) {
            if (src[n] !== undefined && src[n] !== null) return src[n];
        }
    }
    return null;
}

async function loginHandyman(baseUrl, email, password) {
    console.log(`   → Logging in handyman ${email} ...`);
    const res = await callApi(baseUrl, 'POST', '/auth/login', null, {
        email, password, fcmToken: 'seed-fixtures-script',
    });
    if (res.status >= 200 && res.status < 300) {
        const token = extractToken(res.body);
        const userId = extractField(res.body, 'userId', 'id');
        if (token) {
            console.log(`   ✅ Handyman login succeeded.`);
            return { success: true, token, userId };
        }
    }
    console.log(`   ✖ Handyman login failed (status ${res.status}). Raw:`, JSON.stringify(res.body));
    return { success: false };
}

async function seedFixtures() {
    console.log('🧩 seed-fixtures: creating real job (and, if possible, a full lifecycle) so ID-dependent tests point at real data\n');

    const { raw: envRaw, map: envMap } = loadEnv(ENV_PATH);
    const baseUrl = envMap.baseUrl;
    const clientToken = envMap.authToken;
    const clientUserId = envMap.userId;
    if (!baseUrl || !clientToken) {
        throw new Error(`Missing baseUrl/authToken in ${ENV_PATH} — run bootstrap-auth.js first.`);
    }

    let fixture;
    try {
        const dataFile = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
        const data = Array.isArray(dataFile) ? dataFile[0] : dataFile;
        fixture = {
            serviceName: data.serviceName || 'General Plumbing',
            address: data.address || '123 Port Harcourt Way',
            latitude: data.latitude ?? 6.455,
            longitude: data.longitude ?? 3.3942,
        };
    } catch (e) {
        throw new Error(`Could not read fixture data from ${DATA_PATH}: ${e.message}`);
    }

    // ---- Step 1: create a real job under the client account -------------
    console.log('1) Creating a real job under the client account...');
    // scheduledAt must be in the future relative to whenever this actually
    // runs — hardcoding a date will silently go stale, so compute it fresh.
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const createRes = await callApi(baseUrl, 'POST', '/jobs/create', clientToken, {
        title: `Service Request for ${fixture.serviceName}`,
        description: `Need help with ${fixture.serviceName}`,
        category: fixture.serviceName,
        locationAddress: fixture.address,
        imageUrls: [],
        scheduledAt,
        budgetMin: 1000,
        budgetMax: 5000,
        aiSuggestedPriceRange: { min: 1000, max: 5000, currency: 'NGN' },
        latitude: fixture.latitude,
        longitude: fixture.longitude,
        radiusKm: 25,
        minRating: 1,
        skills: [],
        scheduled: true,
    });

    if (!(createRes.status >= 200 && createRes.status < 300)) {
        console.error(`   ✖ jobs/create failed (status ${createRes.status}). Raw response:`, JSON.stringify(createRes.body));
        console.error(`   This is NOT the stale-jobId issue — this is the job-creation endpoint itself`);
        console.error(`   rejecting a well-formed request. Worth filing as its own defect; nothing`);
        console.error(`   downstream can be seeded until this succeeds.`);
        throw new Error('jobs/create failed — cannot proceed with fixture seeding');
    }

    const jobId = extractField(createRes.body, 'jobId', 'id');
    if (!jobId) {
        console.error(`   ✖ jobs/create succeeded (status ${createRes.status}) but no jobId was found in the response.`);
        console.error(`   Raw response:`, JSON.stringify(createRes.body));
        throw new Error('No jobId in jobs/create response — check response shape and adjust extractField()');
    }
    console.log(`   ✅ Real job created: jobId=${jobId}`);

    setEnvValue(envRaw, 'jobId', jobId);
    setEnvValue(envRaw, 'clientId', clientUserId);
    setEnvValue(envRaw, 'requesterId', clientUserId);
    setEnvValue(envRaw, 'recipientId', clientUserId);
    fs.writeFileSync(ENV_PATH, JSON.stringify(envRaw, null, 2));

    const seeded = { jobId, clientId: clientUserId };
    const stillStale = ['quoteId', 'handymanId', 'reviewId'];

    // ---- Step 2: full lifecycle, only if a handyman account is available -
    const hmEmail = process.env.TEST_HANDYMAN_EMAIL;
    const hmPassword = process.env.TEST_HANDYMAN_PASSWORD;

    if (!hmEmail || !hmPassword) {
        console.log('\n⚠ No TEST_HANDYMAN_EMAIL / TEST_HANDYMAN_PASSWORD set — skipping the rest of the lifecycle.');
        console.log('  quoteId, handymanId, and reviewId are still stale ("1") on purpose: submitting a');
        console.log('  quote, hiring, starting, confirming arrival, completing, and reviewing all require');
        console.log('  a second account acting as the handyman, which this environment does not have yet.');
        console.log('  To close this gap: create ONE handyman account on staging (pre-register with');
        console.log('  userType: "PROFESSIONAL" — NOT "HANDYMAN", that value is rejected by this API');
    console.log('  (confirmed via the pre-register enum test: valid values are CLIENT and');
    console.log('  PROFESSIONAL) — then complete the OTP verification once manually. Same one-time');
        console.log('  step bootstrap-auth.js already relies on for the client account), then set');
        console.log('  TEST_HANDYMAN_EMAIL / TEST_HANDYMAN_PASSWORD and re-run. This script will then');
        console.log('  seed the rest automatically.\n');
        printSummary(seeded, stillStale);
        return;
    }

    console.log('\n2) Handyman credentials found — attempting the full job lifecycle...');
    const hmLogin = await loginHandyman(baseUrl, hmEmail, hmPassword);
    if (!hmLogin.success) {
        console.log('   Skipping the rest of the lifecycle — handyman login failed. quoteId/handymanId/reviewId stay stale.');
        printSummary(seeded, stillStale);
        return;
    }
    const handymanToken = hmLogin.token;
    const handymanId = hmLogin.userId;
    setEnvValue(envRaw, 'handymanId', handymanId);
    seeded.handymanId = handymanId;
    stillStale.splice(stillStale.indexOf('handymanId'), 1);
    fs.writeFileSync(ENV_PATH, JSON.stringify(envRaw, null, 2));

    // Handyman submits a quote
    const quoteRes = await callApi(baseUrl, 'POST', `/jobs/${jobId}/quotes?handymanId=${handymanId}`, handymanToken, {
        amount: 3000,
        estimatedHours: 2,
        proposedStartTime: scheduledAt,
    });
    if (!(quoteRes.status >= 200 && quoteRes.status < 300)) {
        console.error(`   ✖ Submitting quote failed (status ${quoteRes.status}). Raw:`, JSON.stringify(quoteRes.body));
        printSummary(seeded, stillStale);
        return;
    }
    const quoteId = extractField(quoteRes.body, 'quoteId', 'id');
    if (!quoteId) {
        console.error(`   ✖ Quote submitted but no quoteId found in response:`, JSON.stringify(quoteRes.body));
        printSummary(seeded, stillStale);
        return;
    }
    setEnvValue(envRaw, 'quoteId', quoteId);
    seeded.quoteId = quoteId;
    stillStale.splice(stillStale.indexOf('quoteId'), 1);
    fs.writeFileSync(ENV_PATH, JSON.stringify(envRaw, null, 2));
    console.log(`   ✅ Quote submitted: quoteId=${quoteId}`);

    // Client hires the handyman
    const hireRes = await callApi(baseUrl, 'POST', `/jobs/${jobId}/quotes/${quoteId}/hire-handyman?clientId=${clientUserId}`, clientToken, null);
    if (!(hireRes.status >= 200 && hireRes.status < 300)) {
        console.error(`   ✖ hire-handyman failed (status ${hireRes.status}). Raw:`, JSON.stringify(hireRes.body));
        printSummary(seeded, stillStale);
        return;
    }
    console.log('   ✅ Handyman hired, job moved to QUOTE_ACCEPTED.');

    // Handyman starts, notifies arrival; client confirms arrival + start
    const steps = [
        ['POST', `/jobs/${jobId}/start?handymanId=${handymanId}`, handymanToken, null, 'handyman start'],
        ['POST', `/jobs/${jobId}/notify-arrival`, handymanToken, null, 'handyman notify-arrival'],
        ['POST', `/jobs/${jobId}/confirm-handyman-arrival`, clientToken, null, 'client confirm-handyman-arrival'],
        ['POST', `/jobs/${jobId}/confirm-start`, clientToken, null, 'client confirm-start'],
        ['POST', `/jobs/${jobId}/confirm-completion`, clientToken, null, 'client confirm-completion'],
        ['POST', `/jobs/${jobId}/complete?requesterId=${clientUserId}`, clientToken, null, 'mark complete'],
    ];
    for (const [method, path, token, body, label] of steps) {
        const res = await callApi(baseUrl, method, path, token, body);
        if (!(res.status >= 200 && res.status < 300)) {
            console.error(`   ✖ ${label} failed (status ${res.status}). Raw:`, JSON.stringify(res.body));
            console.error(`   Stopping lifecycle here — reviewId will stay stale.`);
            printSummary(seeded, stillStale);
            return;
        }
        console.log(`   ✅ ${label} OK`);
    }

    // Client submits a review
    const reviewRes = await callApi(baseUrl, 'POST', `/reviews/job/${jobId}`, clientToken, {
        rating: 5,
        reviewMessage: 'Great work',
    });
    if (!(reviewRes.status >= 200 && reviewRes.status < 300)) {
        console.error(`   ✖ Submitting review failed (status ${reviewRes.status}). Raw:`, JSON.stringify(reviewRes.body));
        printSummary(seeded, stillStale);
        return;
    }
    const reviewId = extractField(reviewRes.body, 'reviewId', 'id');
    if (reviewId) {
        setEnvValue(envRaw, 'reviewId', reviewId);
        seeded.reviewId = reviewId;
        stillStale.splice(stillStale.indexOf('reviewId'), 1);
        fs.writeFileSync(ENV_PATH, JSON.stringify(envRaw, null, 2));
        console.log(`   ✅ Review submitted: reviewId=${reviewId}`);
    }

    printSummary(seeded, stillStale);
}

function printSummary(seeded, stillStale) {
    console.log('\n📋 Fixture seeding summary:');
    Object.entries(seeded).forEach(([k, v]) => console.log(`   ✅ ${k} = ${v} (real, freshly created this run)`));
    stillStale.forEach(k => console.log(`   ⚠  ${k} still stale/placeholder — tests needing it will still fail`));
    console.log('');
}

if (require.main === module) {
    seedFixtures().catch(err => {
        console.error('\n✖ seed-fixtures crashed:', err.message);
        process.exit(1);
    });
}

module.exports = { seedFixtures };

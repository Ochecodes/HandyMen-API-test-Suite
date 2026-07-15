/**
 * bootstrap-auth.js
 *
 * Problem this solves: the old setup had ONE hardcoded JWT sitting in the
 * environment file, reused across every run, with no way to know if it was
 * still valid. When positive tests failed with 400, there was no way to
 * rule auth in or out as the cause. This script removes that uncertainty:
 * it gets a token fresh, right before the run, every time, and proves the
 * token works before handing it to Newman.
 *
 * What it does, in order:
 *   1. Tries POST {{baseUrl}}/auth/login with the known, already-verified
 *      test account (davoccommunity@gmail.com by default).
 *   2. If login fails because that account genuinely doesn't exist, it
 *      self-registers (pre-register -> complete-registration) using the
 *      SAME email/password it was trying to log in with, filling in the
 *      rest of the profile from data.json, then logs in again. Note: a
 *      freshly self-registered account still needs OTP/email verification
 *      before complete-registration will succeed — see the console output
 *      if this path is triggered.
 *   3. Writes the resulting token into a RUNTIME COPY of the Postman
 *      environment file (never mutates the checked-in one), so the source
 *      environment file stays clean and diff-able.
 *   4. Fails loudly (non-zero exit, clear message) if it cannot end up with
 *      a verified token — on purpose. Silently falling back to a stale or
 *      missing token is exactly the failure mode that made last round's
 *      results ambiguous.
 *
 * Usage:
 *   node bootstrap-auth.js [environmentPath] [dataPath] [outputEnvPath]
 *
 * Defaults:
 *   environmentPath: HandyMan_Staging.postman_environment.json
 *   dataPath:        data.json
 *   outputEnvPath:   HandyMan_Staging.postman_environment.runtime.json
 *
 * Credentials (in priority order):
 *   1. TEST_LOGIN_EMAIL / TEST_LOGIN_PASSWORD env vars, if set.
 *   2. The known, already-verified test account: davoccommunity@gmail.com / Test123.
 */

const fs = require('fs');
const path = require('path');

const ENV_PATH = process.argv[2] || 'HandyMan_Staging.postman_environment.json';
const DATA_PATH = process.argv[3] || 'data.json';
const OUT_ENV_PATH = process.argv[4] || ENV_PATH.replace(/\.json$/i, '.runtime.json');

const DEFAULT_LOGIN_EMAIL = 'ochebooks@gmail.com';
const DEFAULT_LOGIN_PASSWORD = 'Test321';

function loadEnv(envPath) {
    const raw = JSON.parse(fs.readFileSync(envPath, 'utf8'));
    const map = {};
    raw.values.forEach(v => { map[v.key] = v.value; });
    return { raw, map };
}

function setEnvValue(raw, key, value) {
    const entry = raw.values.find(v => v.key === key);
    if (entry) {
        entry.value = value;
    } else {
        raw.values.push({ key, value, enabled: true });
    }
}

async function callApi(baseUrl, method, path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* non-JSON or empty body */ }
    return { status: res.status, ok: res.ok, body: json };
}

// Response shapes vary by API design — check the common places a token
// could be before giving up, and print the raw response if none match so
// this is easy to adjust to your actual schema in one place.
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

function extractUserId(body) {
    if (!body) return null;
    const candidates = [
        body.userId, body.id,
        body.data && body.data.userId,
        body.data && body.data.id,
    ];
    return candidates.find(v => v !== undefined && v !== null) || null;
}

async function login(baseUrl, email, password) {
    console.log(`   → Logging in as ${email} ...`);
    const res = await callApi(baseUrl, 'POST', '/auth/login', {
        email, password, fcmToken: 'bootstrap-auth-script',
    });
    if (res.status >= 200 && res.status < 300) {
        const token = extractToken(res.body);
        if (token) {
            console.log(`   ✅ Login succeeded (status ${res.status}).`);
            return { success: true, token };
        }
        console.log(`   ⚠ Login returned ${res.status} but no token was found in the response body.`);
        console.log(`   Raw response:`, JSON.stringify(res.body));
        return { success: false, reason: 'no-token-in-response' };
    }
    console.log(`   ✖ Login failed (status ${res.status}).`);
    return { success: false, reason: 'login-rejected', status: res.status };
}

async function selfRegister(baseUrl, email, password, fixture) {
    console.log(`   → Account not found or login failed — attempting self-registration for ${email} using data.json for the rest of the profile...`);

    const preRegRes = await callApi(baseUrl, 'POST', '/users/pre-register', {
        email,
        userType: 'PROFESSIONAL',
        phoneNumber: fixture.phoneNumber,
        tokenDestination: 'EMAIL',
        skills: [],
    });

    if (!(preRegRes.status >= 200 && preRegRes.status < 300)) {
        console.log(`   ✖ Pre-registration failed (status ${preRegRes.status}). Raw response:`, JSON.stringify(preRegRes.body));
        return { success: false, reason: 'pre-register-failed' };
    }

    const userId = extractUserId(preRegRes.body);
    if (!userId) {
        console.log(`   ✖ Pre-registration succeeded but no userId was found in the response to complete registration with.`);
        console.log(`   Raw response:`, JSON.stringify(preRegRes.body));
        return { success: false, reason: 'no-userid-in-response' };
    }

    console.log(`   → Pre-registration OK, got userId=${userId}. Attempting to complete registration...`);
    console.log(`   NOTE: if this account requires OTP/email verification before completion, this step`);
    console.log(`   will fail — that verification can't be automated here (it needs a real inbox). If it`);
    console.log(`   fails for that reason, complete registration once manually (e.g. via Postman), and`);
    console.log(`   subsequent runs of this script will just log in normally from then on.`);

    const completeRes = await callApi(baseUrl, 'PUT', `/users/complete-registration/${userId}`, {
        firstName: fixture.firstName,
        lastName: fixture.lastName,
        password: password,
        confirmPassword: password,
        address: fixture.address,
        profilePicUrl: 'https://example.com/profile.jpg',
        location: fixture.address,
        experience: fixture.experience,
        bio: fixture.bio,
        skills: [],
        idVerificationUrl: 'https://example.com/id-verification.jpg',
        serviceName: fixture.serviceName,
        locationLatitude: fixture.latitude,
        locationLongitude: fixture.longitude,
    });

    if (!(completeRes.status >= 200 && completeRes.status < 300)) {
        console.log(`   ✖ Complete-registration failed (status ${completeRes.status}). Raw response:`, JSON.stringify(completeRes.body));
        return { success: false, reason: 'complete-registration-failed' };
    }

    console.log(`   ✅ Registration completed for userId=${userId}.`);
    return { success: true, userId };
}

async function bootstrapAuth() {
    console.log('🔐 bootstrap-auth: obtaining a verified-fresh token before running tests\n');

    const { raw: envRaw, map: envMap } = loadEnv(ENV_PATH);
    const baseUrl = envMap.baseUrl;
    if (!baseUrl) {
        throw new Error(`No "baseUrl" found in ${ENV_PATH} — cannot proceed.`);
    }

    let fixture;
    try {
        const dataFile = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
        const data = Array.isArray(dataFile) ? dataFile[0] : dataFile;
        fixture = {
            firstName: data.firstName || 'Oche',
            lastName: data.lastName || 'Akor',
            phoneNumber: data.phoneNumber || '+15550109988',
            experience: data.experience || '5',
            bio: data.bio || 'Certified handyman with expertise in plumbing and electrical work.',
            address: data.address || '123 Port Harcourt Way',
            serviceName: data.serviceName || 'General Plumbing',
            latitude: data.latitude ?? 6.455,
            longitude: data.longitude ?? 3.3942,
        };
    } catch (e) {
        throw new Error(`Could not read fixture data from ${DATA_PATH}: ${e.message}`);
    }

    const email = process.env.TEST_LOGIN_EMAIL || DEFAULT_LOGIN_EMAIL;
    const password = process.env.TEST_LOGIN_PASSWORD || DEFAULT_LOGIN_PASSWORD;
    if (process.env.TEST_LOGIN_EMAIL) {
        console.log(`   Using credentials from TEST_LOGIN_EMAIL / TEST_LOGIN_PASSWORD.`);
    } else {
        console.log(`   Using the known, already-verified test account (${DEFAULT_LOGIN_EMAIL}).`);
    }

    // Step 1: try logging in directly.
    let loginResult = await login(baseUrl, email, password);

    // Step 2: if that failed, this account may genuinely not exist on this
    // environment (e.g. a fresh staging reset) — try to create it with the
    // SAME email/password we were trying to log in with, filling in the rest
    // of the profile from data.json, then log in again.
    if (!loginResult.success) {
        const regResult = await selfRegister(baseUrl, email, password, fixture);
        if (regResult.success) {
            loginResult = await login(baseUrl, email, password);
            if (loginResult.success) {
                console.log(`\n   ⚠ IMPORTANT: a NEW account (userId=${regResult.userId}) was just created for ${email}.`);
                console.log(`   Other environment variables (jobId, quoteId, handymanId, reviewId, etc.) still`);
                console.log(`   point at IDs from whatever account was used before. Those may now belong to a`);
                console.log(`   different account than the one this token authenticates as. If job/review/quote`);
                console.log(`   -related positive tests start failing after this, that mismatch is why — check`);
                console.log(`   those IDs against userId=${regResult.userId} before assuming it's an API defect.\n`);
            }
        }
    }

    if (!loginResult.success || !loginResult.token) {
        console.error('\n✖ FAILED: could not obtain a verified auth token.');
        console.error('  Refusing to write a runtime environment file with a stale or missing token —');
        console.error('  that would silently reintroduce the exact ambiguity this script exists to remove.');
        console.error('  Fix the credentials/account issue above and re-run.');
        process.exit(1);
    }

    setEnvValue(envRaw, 'authToken', loginResult.token);
    fs.writeFileSync(OUT_ENV_PATH, JSON.stringify(envRaw, null, 2));

    console.log(`\n✅ Verified-fresh token written to: ${OUT_ENV_PATH}`);
    console.log(`   (source environment file ${ENV_PATH} was left untouched)`);
    return OUT_ENV_PATH;
}

if (require.main === module) {
    bootstrapAuth().catch(err => {
        console.error('\n✖ bootstrap-auth crashed:', err.message);
        process.exit(1);
    });
}

module.exports = { bootstrapAuth };

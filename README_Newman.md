# HandyMan API Newman Test Suite

This folder contains a Newman-based API test runner for the HandyMan staging backend. The current setup uses a real test collection, a data-driven fixture file, and helper scripts that bootstrap authentication and seed a real job before the run.

## What is in this folder
- `HandyMan_API_postman_collection.with_negatives.json` — the main Postman collection used by Newman
- `HandyMan_Staging.postman_environment.json` — the checked-in environment template
- `HandyMan_Staging.postman_environment.runtime.json` — generated at runtime with the fresh token and seeded IDs
- `data.json` — fixture values used for profile data and iteration data
- `run-tests.js` — the main runner that boots auth, seeds fixtures, and executes Newman
- `bootstrap-auth.js` — gets a fresh auth token before the run
- `seed-fixtures.js` — creates a real job and updates environment values for job-dependent requests
- `scripts/` — helper utilities for fixing auth/body issues and merging results

## Prerequisites
- Node.js and npm installed
- Access to the staging API
- A valid test account or a working login path for the bootstrap script

## One-time setup
Run this from the project folder:

```bash
npm install
```

## Configure test credentials (optional)
The runner can work with the default credentials already defined in the bootstrap script, but you can override them with environment variables:

```bash
set TEST_LOGIN_EMAIL=your-client-email
set TEST_LOGIN_PASSWORD=your-client-password

set TEST_HANDYMAN_EMAIL=your-handyman-email
set TEST_HANDYMAN_PASSWORD=your-handyman-password
```

If you do not provide handyman credentials, the suite will still run, but quote/handyman/review-related steps will remain limited because the full lifecycle cannot be completed without a second account.

## Update fixture data
Edit `data.json` if you want to change the test profile values used by the suite:

- first name / last name
- phone number
- address
- service name
- latitude / longitude
- experience / bio

## Run the full suite
```bash
npm test
```

This command will:
1. Bootstrap a fresh auth token
2. Seed a real job fixture (when possible)
3. Run Newman against the collection
4. Write results to:
   - `results/newman-results.json`
   - `results/newman-report.html`

## Outputs
- `results/newman-results.json` — structured JSON results for each request/execution
- `results/newman-report.html` — HTML report for review or sharing
- `HandyMan_Staging.postman_environment.runtime.json` — temporary runtime environment generated for the run

## Helpful notes
- The bootstrap step writes a runtime environment file rather than changing the checked-in environment file directly.
- Job, quote, handyman, and review IDs are seeded dynamically where possible, so they are less likely to be stale than the older hardcoded values.
- If the login flow needs self-registration, the script will attempt it using the values from `data.json`.
- Some destructive or lifecycle endpoints should be used carefully against staging, especially if your environment is shared.

## Optional helper scripts
- `node scripts/update-collection-from-data.js` — updates raw JSON bodies in the collection using values from `data.json`
- `node scripts/merge-results.js ...` — merges the Newman results with the collection and a workbook if you have the required file available


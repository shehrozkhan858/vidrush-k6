# vidrush-k6

Standalone k6 stress test for vidrush's internal API. Independent project — not related to walsworth-qa-global; only its folder layout (config/PageObjects/Tests/utils/custom-report-generator) was used as a structural reference, no code was copied.

## Layout
- `config/env.js` — base URL + default thresholds
- `config/profiles.js` — named load profiles (baseline/load/soak/spike/stress), selected via `-e CONFIG_PROFILE=<name>` (see below)
- `utils/tokenPool.js` — loads a pool of Bearer JWTs, one per VU (round-robin)
- `utils/helpers.js` — shared `extractFirstId()` (pull an id out of a list response) and `checkStatus()` (a `check()` wrapper that accepts a list of "this is a legitimate outcome" status codes, not just 200)
- `PageObjects/videoProjectsAPI.js` — wrappers for project-scoped endpoints (list/get project, scripts, recipes, overlays, thumbnails, render tasks, footage, render-eligibility, quote-statements)
- `PageObjects/accountAPI.js` — wrappers for everything scoped to "me" (profile, credits, billing, seats, teams)
- `PageObjects/catalogAPI.js` — wrappers for shared/public reference data (generation models, subscription plans, voice profiles, onboarding, brand configs, ai-avatars, etc.)
- `Tests/videoProjectsReadFlow.js` — the original 3-endpoint smoke flow: `GET /users/me` → `GET /video-projects` (list) → `GET /video-projects/:id` (get)
- `Tests/fullReadFlow.js` — full-coverage flow: ~30 read-only GET endpoints per iteration across account/catalog/video-projects, grouped to mirror a real user session. See the comment block at the top of the file for exactly what's covered and what's deliberately excluded (and why). Load profile for either test file comes from `config/profiles.js` via `getConfig()`
- `tokens.json` — JWT pool (gitignored). Each entry is one distinct virtual-user identity — see "Adding more tokens" below.
- `custom-report-generator/` — turns a k6 NDJSON run into a single self-contained HTML report (see below)

## Load profiles
Set via `-e CONFIG_PROFILE=<name>` (default: `load`). Defined in `config/profiles.js`:

| Profile    | Shape                                              | Purpose                                  |
|------------|-----------------------------------------------------|-------------------------------------------|
| `baseline` | 1 VU, 30s                                          | Quick sanity check                       |
| `load`     | 0→20→0 VUs over 3m                                 | Original light-load profile (default)    |
| `soak`     | 10 VUs held for 15m                                | Sustained load — watch for degradation/leaks |
| `spike`    | burst to `SPIKE_TARGET` (default 50) then release  | Sudden traffic burst                     |
| `stress`   | step-ramp up to `STRESS_MAX_VUS` (default 100)     | Find the breaking point under high concurrency |

```powershell
# Stress test, default ceiling (100 VUs)
k6 run -e CONFIG_PROFILE=stress Tests/videoProjectsReadFlow.js

# Stress test, custom ceiling/step
k6 run -e CONFIG_PROFILE=stress -e STRESS_MAX_VUS=200 -e STRESS_STEP=25 Tests/videoProjectsReadFlow.js

# Or via the npm script (also writes NDJSON + generates the HTML report)
npm run test:stress

# Same profiles against the full ~30-endpoint coverage flow instead of the
# original 3-endpoint smoke flow: test:baseline:full / test:load:full /
# test:soak:full / test:spike:full / test:stress:full
npm run test:stress:full
```

Note: with only 1 token in `tokens.json`, all VUs round-robin the same identity, so a run exercises API/infra capacity as one authenticated user rather than many distinct sessions. Add more tokens (see "Adding more tokens" below) for genuine multi-identity load — each VU keeps the same token for its whole run (`(__VU - 1) % tokens.length`), so more tokens than VUs isn't needed, but fewer tokens than VUs means some identities get hit by more than one concurrent VU.

`Tests/fullReadFlow.js` additionally uses each VU's own token to list *that account's own* video projects and drills into a real owned project id when one exists (falling back to `FALLBACK_PROJECT_ID` only for accounts with none) — so with multiple tokens for accounts that actually have projects, the report reflects real per-account data, not one project being hit repeatedly from different logins.

## Before running

**⚠ 2026-09-03 correction:** `BASE_URL` was previously defaulting to `https://dev.docs.api.vidrush.ai`, which turned out to be the *documentation* site, not the API — a NextAuth-gated Next.js app that 307-redirects any request under paths like `/users/me` to its own `/auth/signin` page, which then renders with a plain `200`. Every prior run against that host (including `reports/stress-2026-09-03-1.html`) was unknowingly stress-testing that sign-in redirect, not the real backend — status-code-only checks couldn't tell the two apart. `BASE_URL` now defaults to `https://dev.api.vidrush.ai` (confirmed real: AWS API Gateway error shape, `{"message":"Forbidden"}` + `x-amzn-*` headers), and every check in `Tests/fullReadFlow.js` now also verifies the response body actually looks like JSON (`utils/helpers.js`'s `checkStatus`/`looksLikeJson`), so this class of false pass can't happen silently again.

The 307-then-200 redirect behavior described below was specific to the wrong (docs) host — the real API doesn't do that; a bad/wrong-audience token now correctly shows up as a `403` with a JSON `{"message":"Forbidden"}` body, not a disguised `200`.

If neither `k6` nor `node` are on your shell's PATH, use the full paths that were found on this machine:
- k6: `C:\Program Files\k6\k6.exe`
- node: `C:\Program Files\nodejs\node.exe`

## Running a real stress test (start here)

The dev API (`https://dev.api.vidrush.ai`) appears to be network-restricted — from an unallowlisted machine, **every** request returns the same `403 {"message":"Forbidden"}` whether you send a valid Bearer token, an `x-api-key`, or no credentials at all. That's AWS API Gateway rejecting at the resource-policy/WAF layer, before auth is evaluated. So:

```bash
# 0. Get on the network that can actually reach the API (VPN / office / CI runner inside the VPC).

# 1. Pre-flight: are the tokens usable from here? (fast, ~3 requests)
npm run verify:tokens
#    -> want "3/3 token(s) usable". If you get 403s, you're either still off-network
#       or the tokens are wrong — either way, don't bother running the stress test yet.

# 2. Full stress run (step-ramps to 100 VUs over ~6 min, ~33 read-only endpoints per iteration).
#    Writes NDJSON + generates the HTML report in one go.
npm run test:stress:full

# 3. Open the report
open reports/stress-full-<date>-1.html    # macOS
```

Scale it down/up with `-e STRESS_MAX_VUS` / `-e STRESS_STEP` if 100 VUs is too aggressive for dev:
```bash
k6 run -e CONFIG_PROFILE=stress -e STRESS_MAX_VUS=30 -e STRESS_STEP=10 \
  --out json=reports/stress-full-results.ndjson Tests/fullReadFlow.js
node custom-report-generator/generate-report.js reports/stress-full-results.ndjson stress-full
```

## Run
```powershell
# Smoke test: 1 VU, few iterations
k6 run --vus 1 --iterations 3 Tests/videoProjectsReadFlow.js

# Full light-load run (as configured in the script's `stages`)
k6 run Tests/videoProjectsReadFlow.js

# Override base URL or add more tokens without editing files
k6 run -e BASE_URL=https://your-host -e K6_TOKENS="jwt1,jwt2,jwt3" Tests/videoProjectsReadFlow.js
```

`handleSummary` (built into the test file) writes a quick aggregate `summary.json` after every run regardless of how you invoke it.

## Adding more tokens
Either:
- Add more entries to the `tokens.json` array, or
- Pass `-e K6_TOKENS="jwt1,jwt2,jwt3"` (comma or newline separated) at run time — this takes priority over `tokens.json`, and doesn't touch a tracked file at all (handy for CI or a one-off run).

`tokens.json` is just a flat JSON array of raw JWT strings, e.g.:
```json
[
  "eyJhbGciOi...tokenForTester3...",
  "eyJhbGciOi...tokenForTester4...",
  "eyJhbGciOi...tokenForTester5..."
]
```
No labeling needed — `utils/tokenPool.js` decodes each token's own `properties.email` claim (via `k6/encoding`, not a real signature check — it doesn't need to be, the API does that) purely to print a human-readable identity per VU. `Tests/fullReadFlow.js` logs `VU <n> authenticated as <email> (pool size: <n>)` once per VU on its first iteration, so a run's console/CI output makes it obvious how many distinct identities actually participated.

**Don't put tokens in an Excel file.** A few reasons:
- It's a secret credential store — `.xlsx` is a binary zip format, so it can't be diffed, grepped, or safely gitignored the way a plain-text file can (people forget binary files are in a repo far more easily than they forget a `.json`).
- k6's JS runtime can't read `.xlsx` at all — you'd need an extra conversion step (a separate script + a library like `xlsx`/`exceljs`) just to turn it back into the array k6 needs, for zero benefit over writing that array directly.
- `tokens.json` already does everything you'd want a spreadsheet for here (one token per row, easy to add/remove) with none of the downsides, and it's already wired up end-to-end and already gitignored.

If you later want more structure than "one token per line" (e.g. tagging *why* an account exists — "has projects", "no projects", "team owner") that's still better as JSON (`[{ "token": "...", "note": "team owner, 12 projects" }, ...]`) than a spreadsheet — say the word and I'll extend `tokenPool.js` to accept that shape too; right now it expects plain strings.

More VUs than tokens is fine; VUs share tokens round-robin (same VU keeps the same token for its whole run).

## Generating the HTML report
For the full per-endpoint dashboard (summary cards, endpoint latency table, VU/response-time/error charts), have k6 write NDJSON, then feed it to the generator:

```powershell
# 1. Run with --out json=<file> instead of the default console-only output
k6 run --out json=results.ndjson Tests/videoProjectsReadFlow.js

# 2. Generate the report (writes to reports/<label>-<date>-<n>.html, auto-numbered)
node custom-report-generator/generate-report.js results.ndjson light-load
```

Open the resulting file in `reports/` in a browser. Re-running step 2 against the same label/day creates a new numbered file rather than overwriting the previous report; `results.ndjson` and `reports/` are gitignored since they're run artifacts, not source.

### What the report shows
- **Summary cards** — test label, duration, max VUs, total requests, error rate, check pass rate, p95 latency, total data sent/received
- **Charts** — VUs over time, average response time over time (bucketed), and an error-count-by-endpoint bar chart (only rendered if there were failures)
- **Endpoint table** — per-endpoint samples/fails/error%/avg/min/max/median/p90/p95/throughput, with a TOTAL row
- **Errors section** — every distinct (status, endpoint, method) failure combo with a count and first/last-seen time, or a green "no errors" note if the run was clean

`custom-report-generator/lib/errorSection.js` holds the shared error-bucket accumulation/rendering logic; `generate-report.js` is the CLI entry point and can also be `require()`'d as `{ generateReport }` to call from other scripts.

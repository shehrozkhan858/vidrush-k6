import { SharedArray } from 'k6/data';
import encoding from 'k6/encoding';

// Tokens are supplied one of two ways, in priority order:
// 1. K6_TOKENS env var - newline or comma separated JWTs (pass with -e K6_TOKENS="...")
// 2. tokens.json in the project root - a JSON array of JWT strings
const tokens = new SharedArray('authTokens', function () {
  const fromEnv = __ENV.K6_TOKENS;
  if (fromEnv) {
    const parsedFromEnv = fromEnv
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (parsedFromEnv.length > 0) return parsedFromEnv;
  }

  const raw = open('../tokens.json');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('tokens.json must contain a non-empty JSON array of JWTs');
  }
  return parsed;
});

export function tokenForVU() {
  const index = (__VU - 1) % tokens.length;
  return tokens[index];
}

// Decodes the (unsigned, not-our-problem-to-verify) JWT payload just to pull
// out a human-readable identity for logging/reporting — we're not trusting
// this for auth, the API does that.
function decodeIdentity(jwt) {
  try {
    const payloadSegment = jwt.split('.')[1];
    const json = encoding.b64decode(payloadSegment, 'rawurl', 's');
    const payload = JSON.parse(json);
    return (payload.properties && payload.properties.email) || payload.sub || null;
  } catch (e) {
    return null;
  }
}

// Best-effort "who is this VU logged in as" label, auto-derived from the
// token's own email claim — no need to hand-label tokens.json entries.
export function identityForVU() {
  const index = (__VU - 1) % tokens.length;
  return decodeIdentity(tokens[index]) || `token#${index}`;
}

export function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${tokenForVU()}`,
  };
}

export function tokenPoolSize() {
  return tokens.length;
}

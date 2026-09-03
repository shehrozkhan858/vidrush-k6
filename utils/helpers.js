import { check } from 'k6';

/**
 * Extracts the first record's id from a list-style response, tolerant of
 * both `{ data: [...] }` and bare-array response shapes. Returns null if
 * nothing usable is found (e.g. a VU whose account has no projects, or the
 * request itself failed/wasn't JSON).
 */
export function extractFirstId(res) {
  try {
    const body = res.json();
    const list = Array.isArray(body) ? body : body.data;
    const first = Array.isArray(list) ? list[0] : undefined;
    if (!first) return null;
    return first._id || first.id || null;
  } catch (e) {
    return null;
  }
}

/**
 * True if a response looks like real API JSON rather than an HTML page
 * (e.g. an auth gateway silently redirecting to a sign-in page that itself
 * renders with a 200). Guards against the exact failure mode found on
 * 2026-09-03: dev.docs.api.vidrush.ai 307'd every unauthenticated request to
 * /auth/signin, which rendered 200 — a status-code-only check couldn't tell
 * that apart from a real success. This is deliberately conservative: it only
 * checks the response *looks* like JSON (Content-Type header or a body that
 * starts with `{`/`[`), not that it's the *correct* JSON — that's what the
 * rest of a test's own assertions are for.
 */
export function looksLikeJson(res) {
  const contentType = (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || '';
  if (contentType.toLowerCase().includes('json')) return true;
  const body = typeof res.body === 'string' ? res.body.trim() : '';
  return body.startsWith('{') || body.startsWith('[');
}

/**
 * Standard check wrapper for read-only GET calls in the full-coverage flow.
 *
 * `okCodes` defaults to [200]. Pass extra codes for endpoints that are
 * expected to legitimately return something other than 200 depending on
 * which identity/VU is calling and what that account owns/is scoped to
 * (e.g. a resource fallback-ID that belongs to a different account than the
 * one this VU is authenticated as -> 403/404 is correct behavior, not a bug).
 *
 * Every call also gets a `looksLikeJson` check so a masked auth-gate
 * redirect (200 status, HTML sign-in page body) fails loudly instead of
 * silently counting as a pass. Pass `expectJson: false` for the rare
 * endpoint that's genuinely not JSON.
 */
export function checkStatus(res, label, okCodes = [200], { expectJson = true } = {}) {
  const statusOk = check(res, {
    [`${label} status is ${okCodes.join('/')}`]: (r) => okCodes.includes(r.status),
  });
  const jsonOk = expectJson
    ? check(res, {
        [`${label} body looks like JSON (not an auth-gate redirect page)`]: (r) => looksLikeJson(r),
      })
    : true;
  return statusOk && jsonOk;
}

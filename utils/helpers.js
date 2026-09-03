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
 * Standard check wrapper for read-only GET calls in the full-coverage flow.
 *
 * `okCodes` defaults to [200]. Pass extra codes for endpoints that are
 * expected to legitimately return something other than 200 depending on
 * which identity/VU is calling and what that account owns/is scoped to
 * (e.g. a resource fallback-ID that belongs to a different account than the
 * one this VU is authenticated as -> 403/404 is correct behavior, not a bug).
 */
export function checkStatus(res, label, okCodes = [200]) {
  return check(res, {
    [`${label} status is ${okCodes.join('/')}`]: (r) => okCodes.includes(r.status),
  });
}

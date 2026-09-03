// The real dev API is https://dev.api.vidrush.ai/v1 — note the `/v1`.
//
// Two wrong turns worth recording so nobody repeats them (both found 2026-09-03):
//
// 1. This previously defaulted to https://dev.docs.api.vidrush.ai, which is the
//    *documentation* site, not the API — a NextAuth-gated Next.js app that
//    307-redirects paths like /users/me to its own /auth/signin page, which then
//    renders with a normal 200. A status-code-only check can't tell that apart
//    from a real API 200, so runs looked clean while testing nothing.
//
// 2. Dropping the `/v1` base path makes every request — authenticated or not,
//    including documented-public routes — return `403 {"message":"Forbidden"}`.
//    That's API Gateway's response for a path with no matching base-path mapping
//    on a custom domain; it is NOT an auth failure, even though it looks exactly
//    like one. A wrong/expired token also returns 403, so the two are
//    indistinguishable by status alone. If everything 403s, check the base path
//    before you go hunting for credential problems.
export const BASE_URL = (__ENV.BASE_URL || 'https://dev.api.vidrush.ai/v1').replace(/\/+$/, '');

export const THRESHOLDS = {
  http_req_duration: ['p(95)<2000'],
  http_req_failed: ['rate<0.05'],
};

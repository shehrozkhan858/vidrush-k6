import http from 'k6/http';
import { BASE_URL } from '../config/env.js';
import { authHeaders } from '../utils/tokenPool.js';

export function listVideoProjects(params = {}) {
  const merged = { limit: '10', includeCreator: 'true', ...params };
  const query = Object.keys(merged)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(merged[key])}`)
    .join('&');
  return http.get(`${BASE_URL}/video-projects?${query}`, {
    headers: authHeaders(),
    tags: { name: 'ListVideoProjects' },
  });
}

export function getVideoProject(videoProjectId) {
  return http.get(`${BASE_URL}/video-projects/${videoProjectId}`, {
    headers: authHeaders(),
    tags: { name: 'GetVideoProject' },
  });
}

export function getCurrentUser() {
  return http.get(`${BASE_URL}/users/me`, {
    headers: authHeaders(),
    tags: { name: 'GetCurrentUser' },
  });
}

// --- Project-scoped reads added for full-coverage runs ---------------------
// All GET, all read-only. `videoProjectId` is expected to be either a real
// id the current VU's account owns (preferred — pass what `listVideoProjects`
// returned) or the shared FALLBACK_PROJECT_ID; either way these are safe to
// call, they just may legitimately 403/404 when the id isn't owned by the
// calling identity.
const get = (path, name) =>
  http.get(`${BASE_URL}${path}`, { headers: authHeaders(), tags: { name } });

export const listVideoProjectsWithRenders = () => get('/video-projects/with-renders', 'ListVideoProjectsWithRenders');
// NOTE (2026-09-03): NOT in the load flow — this route doesn't exist on dev.
// `/video-projects/processing` falls through to the `/video-projects/:id`
// route, which rejects "processing" with
//   {"params.id":["Invalid ObjectId format"]}
// i.e. a 400, not a 404, because the literal path is shadowed by the
// parameterised one. Kept here for whenever the route is actually deployed.
export const getProcessingProjects = (updatedAtAfter) => {
  const since = updatedAtAfter || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return get(`/video-projects/processing?updatedAtAfter=${encodeURIComponent(since)}`, 'GetProcessingProjects');
};

export const listVideoScripts = (id) => get(`/video-projects/${id}/scripts`, 'ListVideoScripts');
export const getLatestVideoScript = (id) => get(`/video-projects/${id}/scripts/latest`, 'GetLatestVideoScript');

export const listProjectRecipes = (id) => get(`/video-projects/${id}/recipes`, 'ListProjectRecipes');
export const getLatestRecipe = (id) => get(`/video-projects/${id}/recipes/latest`, 'GetLatestRecipe');

export const getVideoOverlay = (id) => get(`/video-projects/${id}/video-overlays`, 'GetVideoOverlay');
export const listVideoOverlayHistory = (id) => get(`/video-projects/${id}/video-overlays/history`, 'ListVideoOverlayHistory');

export const listThumbnails = (id) => get(`/video-projects/${id}/thumbnails`, 'ListThumbnails');
export const listRenderTasksByProject = (id) => get(`/video-projects/${id}/render-tasks`, 'ListRenderTasksByProject');
export const listFootage = (id) => get(`/video-projects/${id}/footage`, 'ListFootage');
export const getRenderEligibility = (id) => get(`/video-projects/${id}/render-eligibility`, 'GetRenderEligibility');
export const getQuoteStatement = (id) => get(`/video-projects/${id}/quote-statements`, 'GetQuoteStatement');

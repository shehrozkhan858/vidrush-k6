// Shared/catalog reads — not scoped to a specific video project. A mix of
// public (no-auth-required) and authenticated GETs. All read-only, safe.
import http from 'k6/http';
import { BASE_URL } from '../config/env.js';
import { authHeaders } from '../utils/tokenPool.js';

const get = (path, name) => http.get(`${BASE_URL}${path}`, { headers: authHeaders(), tags: { name } });

// Public — no auth required by the API, but we still send the header
// (harmless) so behavior is consistent for signed-out vs. signed-in checks.
export const listGenerationModels = () => get('/generation-models?type=video', 'ListGenerationModels');
export const listGenerationModelFamilies = () => get('/generation-models/families', 'ListGenerationModelFamilies');

// NOTE (2026-09-03): two endpoints in the Postman collection 404 on dev under
// /v1 and are therefore excluded from the load flow — worth confirming whether
// the routes were removed or the collection is stale:
//   GET /subscription-plans        -> 404 (use /billing/subscription-plans, which works)
//   GET /video-generation-models   -> 404 (plain /generation-models works)
export const listVoiceProfiles = () => get('/voice-profiles', 'ListVoiceProfiles');
export const listSharedVoiceProfiles = () => get('/voice-profiles/shared', 'ListSharedVoiceProfiles');
export const getVoiceProfile = (voiceId) => get(`/voice-profiles/${voiceId}`, 'GetVoiceProfile');
export const listYoutubeWhitelist = () => get('/youtube-channel-whitelist', 'ListYoutubeWhitelist');
export const listLocalFileStorage = () => get('/local-files/storage', 'ListLocalFileStorage');
export const listBrandConfigs = () => get('/brand-configs', 'ListBrandConfigs');
export const listAiAvatars = () => get('/ai-avatars?page=1', 'ListAiAvatars');

export const getOnboardingForm = () => get('/onboarding/form?formKey=onboarding', 'GetOnboardingForm');
export const getOnboardingStatus = () => get('/onboarding/status?formKey=onboarding', 'GetOnboardingStatus');

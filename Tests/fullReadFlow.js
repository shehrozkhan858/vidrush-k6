// Full-coverage read-only flow: simulates a real logged-in user browsing
// their account, the shared catalog, and their video projects — one full
// pass over ~30 GET endpoints per iteration, grouped to mirror how a user
// would actually move through the app. Every call is read-only (GET); no
// endpoint here creates/deletes data, spends credits, or triggers a render.
//
// Deliberately excluded, even though they're GET-shaped, because they have
// real side effects or cost:
//   - GET /video-projects/:id/questions        (triggers an LLM generation)
//   - GET /thumbnails/reference-videos          (triggers an external search)
//   - anything under /admin/*                   (requires admin role; would
//                                                 just 403 for normal test
//                                                 accounts and pollute the
//                                                 error section)
//   - /api-keys/verify                          (different, incompatible
//                                                 auth scheme)
//   - GET /auth/verify                          (404s on this BASE_URL —
//                                                 confirmed via smoke test;
//                                                 that route apparently only
//                                                 exists on the separate
//                                                 dev.auth.vidrush.ai host,
//                                                 not this docs-api host)
//
// Profile picked via -e CONFIG_PROFILE=<baseline|load|soak|spike|stress>
// (default: load). See config/profiles.js for what each one does.
import { sleep, group } from 'k6';
import { getConfig } from '../config/profiles.js';
import { identityForVU, tokenPoolSize } from '../utils/tokenPool.js';
import { extractFirstId, checkStatus } from '../utils/helpers.js';
import * as account from '../PageObjects/accountAPI.js';
import * as catalog from '../PageObjects/catalogAPI.js';
import {
  listVideoProjects,
  getVideoProject,
  listVideoProjectsWithRenders,
  listVideoScripts,
  getLatestVideoScript,
  listProjectRecipes,
  getLatestRecipe,
  getVideoOverlay,
  listVideoOverlayHistory,
  listThumbnails,
  listRenderTasksByProject,
  listFootage,
  getRenderEligibility,
  getQuoteStatement,
} from '../PageObjects/videoProjectsAPI.js';

// Used only if a VU's own account has no video projects to read back.
const FALLBACK_PROJECT_ID = __ENV.FALLBACK_PROJECT_ID || '6a59253d2141cc151fad0c21';
// A fallback voice profile id (from the collection's own example) used the
// same way — real id preferred, this is just so the call always has *some*
// id to hit.
const FALLBACK_VOICE_ID = __ENV.FALLBACK_VOICE_ID || 'HHstJSjlLg0NG8fanfeK';

export const options = getConfig();

export default function () {
  // Log which identity each VU resolved to, once, so a run's console output
  // (and CI logs) make it obvious whether this was a real multi-identity
  // run or everyone round-robin'd the same one/few tokens.
  if (__ITER === 0) {
    console.log(`VU ${__VU} authenticated as ${identityForVU()} (pool size: ${tokenPoolSize()})`);
  }

  // --- Account: everything scoped to "me" for this VU's identity ---------
  group('account', function () {
    checkStatus(account.getCurrentUser(), 'users/me');
    checkStatus(account.getCurrentUserDetailed(), 'users/me/detailed');
    checkStatus(account.getUserCredits(), 'users/me/credits');
    checkStatus(account.getCreditHistory(), 'users/me/credits/history');
    checkStatus(account.getUserDiscounts(), 'users/me/discounts');
    checkStatus(account.getPayAsYouGoSettings(), 'billing/pay-as-you-go/settings');
    checkStatus(account.getUsageReport(), 'billing/pay-as-you-go/usage-report');
    checkStatus(account.getBillingSubscriptionPlans(), 'billing/subscription-plans');
    checkStatus(account.listSeats(), 'users/me/seats');
    checkStatus(account.listGrantedSeats(), 'users/me/granted-seats');
    checkStatus(account.listTeams(), 'teams');
    checkStatus(account.listGrantedTeams(), 'users/me/granted-teams');
  });

  // --- Catalog: shared/public reference data, not owned by any one user --
  group('catalog', function () {
    checkStatus(catalog.listGenerationModels(), 'generation-models');
    checkStatus(catalog.listGenerationModelFamilies(), 'generation-models/families');
    checkStatus(catalog.listVoiceProfiles(), 'voice-profiles');
    checkStatus(catalog.listSharedVoiceProfiles(), 'voice-profiles/shared');
    // Fallback voice id may not exist -> 404 is a legitimate outcome, not a bug.
    checkStatus(catalog.getVoiceProfile(FALLBACK_VOICE_ID), 'voice-profiles/:id', [200, 404]);
    checkStatus(catalog.listYoutubeWhitelist(), 'youtube-channel-whitelist');
    checkStatus(catalog.listLocalFileStorage(), 'local-files/storage');
    checkStatus(catalog.listBrandConfigs(), 'brand-configs');
    checkStatus(catalog.listAiAvatars(), 'ai-avatars');
    checkStatus(catalog.getOnboardingForm(), 'onboarding/form');
    checkStatus(catalog.getOnboardingStatus(), 'onboarding/status');
  });

  // --- Video projects: list the VU's own projects, then drill into one ---
  let projectId = FALLBACK_PROJECT_ID;
  let ownedProject = false;

  group('video-projects', function () {
    const listRes = listVideoProjects();
    const listOk = checkStatus(listRes, 'video-projects list');
    if (listOk) {
      const foundId = extractFirstId(listRes);
      if (foundId) {
        projectId = foundId;
        ownedProject = true;
      }
    }
    checkStatus(listVideoProjectsWithRenders(), 'video-projects/with-renders');

    // A real, owned id should reliably 200. A fallback id belonging to a
    // *different* account is expected to come back 403/404 — that's the
    // API correctly enforcing ownership, not an error worth flagging.
    const idOkCodes = ownedProject ? [200] : [200, 403, 404];
    const subResourceOkCodes = ownedProject ? [200, 404] : [200, 403, 404];

    checkStatus(getVideoProject(projectId), 'video-projects/:id', idOkCodes);
    checkStatus(listVideoScripts(projectId), 'video-projects/:id/scripts', subResourceOkCodes);
    checkStatus(getLatestVideoScript(projectId), 'video-projects/:id/scripts/latest', subResourceOkCodes);
    checkStatus(listProjectRecipes(projectId), 'video-projects/:id/recipes', subResourceOkCodes);
    checkStatus(getLatestRecipe(projectId), 'video-projects/:id/recipes/latest', subResourceOkCodes);
    checkStatus(getVideoOverlay(projectId), 'video-projects/:id/video-overlays', subResourceOkCodes);
    checkStatus(listVideoOverlayHistory(projectId), 'video-projects/:id/video-overlays/history', subResourceOkCodes);
    checkStatus(listThumbnails(projectId), 'video-projects/:id/thumbnails', subResourceOkCodes);
    checkStatus(listRenderTasksByProject(projectId), 'video-projects/:id/render-tasks', subResourceOkCodes);
    checkStatus(listFootage(projectId), 'video-projects/:id/footage', subResourceOkCodes);
    checkStatus(getRenderEligibility(projectId), 'video-projects/:id/render-eligibility', subResourceOkCodes);
    checkStatus(getQuoteStatement(projectId), 'video-projects/:id/quote-statements', subResourceOkCodes);
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data.metrics.http_req_duration, null, 2) + '\n(full summary written to summary.json)\n',
    'summary.json': JSON.stringify(data, null, 2),
  };
}

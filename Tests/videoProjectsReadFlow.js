import { sleep, check, group } from 'k6';
import { getConfig } from '../config/profiles.js';
import { listVideoProjects, getVideoProject, getCurrentUser } from '../PageObjects/videoProjectsAPI.js';

// Used only if a VU's list call returns no projects to read back.
const FALLBACK_PROJECT_ID = __ENV.FALLBACK_PROJECT_ID || '6a59253d2141cc151fad0c21';

// Profile picked via -e CONFIG_PROFILE=<baseline|load|soak|spike|stress> (default: load).
// See config/profiles.js for what each one does.
export const options = getConfig();

function extractFirstProjectId(res) {
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

export default function () {
  group('users/me', function () {
    const res = getCurrentUser();
    check(res, {
      'users/me status is 200': (r) => r.status === 200,
    });
  });

  let projectId = FALLBACK_PROJECT_ID;

  group('video-projects list', function () {
    const res = listVideoProjects();
    const ok = check(res, {
      'list status is 200': (r) => r.status === 200,
    });
    if (ok) {
      const foundId = extractFirstProjectId(res);
      if (foundId) projectId = foundId;
    }
  });

  group('video-projects get', function () {
    const res = getVideoProject(projectId);
    check(res, {
      'get status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(data.metrics.http_req_duration, null, 2) + '\n(full summary written to summary.json)\n',
    'summary.json': JSON.stringify(data, null, 2),
  };
}

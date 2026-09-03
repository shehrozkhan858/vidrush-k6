/**
 * Named load profiles for vidrush-k6.
 *
 * Pick a profile with `-e CONFIG_PROFILE=<name>` at run time; the test file
 * does `export const options = getConfig();` and picks it up automatically.
 *
 * Usage:
 *   k6 run -e CONFIG_PROFILE=stress Tests/videoProjectsReadFlow.js
 *
 * Available profiles:
 *   - baseline:  1 VU, 30s              - quick sanity check
 *   - load:      0->20->0 VUs over 3m   - the original light-load profile (default)
 *   - soak:      10 VUs, 15m            - sustained load, watch for degradation/leaks
 *   - spike:     0->50->0 VUs, ~1m20s   - sudden burst then release
 *   - stress:    step-ramp up to breaking point (see STRESS_MAX_VUS below)
 */

import { THRESHOLDS } from './env.js';

const PROFILES = {
  baseline: {
    vus: 1,
    duration: '30s',
    thresholds: THRESHOLDS,
  },

  // The original hand-written stages from videoProjectsReadFlow.js.
  load: {
    stages: [
      { duration: '30s', target: 20 },
      { duration: '2m', target: 20 },
      { duration: '30s', target: 0 },
    ],
    thresholds: THRESHOLDS,
  },

  soak: {
    stages: [
      { duration: '1m', target: 10 },
      { duration: '15m', target: 10 },
      { duration: '1m', target: 0 },
    ],
    thresholds: THRESHOLDS,
  },

  spike: (() => {
    const baseline = parseInt(__ENV.SPIKE_BASELINE || '2');
    const peak = parseInt(__ENV.SPIKE_TARGET || '50');
    return {
      stages: [
        { duration: '10s', target: baseline },
        { duration: '10s', target: peak },   // sudden burst
        { duration: '30s', target: peak },   // hold
        { duration: '10s', target: baseline }, // release
        { duration: '20s', target: baseline }, // observe recovery
      ],
      thresholds: THRESHOLDS,
    };
  })(),

  // Step-ramp well past normal load to find where error rate/latency breaks down.
  // Override the ceiling and step size with -e STRESS_MAX_VUS / -e STRESS_STEP.
  stress: (() => {
    const maxVUs = parseInt(__ENV.STRESS_MAX_VUS || '100');
    const step = parseInt(__ENV.STRESS_STEP || Math.max(1, Math.round(maxVUs / 5)));
    const stepDuration = __ENV.STRESS_STEP_DURATION || '1m';

    const stages = [];
    for (let target = step; target < maxVUs; target += step) {
      stages.push({ duration: stepDuration, target });
    }
    stages.push({ duration: stepDuration, target: maxVUs });
    stages.push({ duration: '1m', target: 0 }); // ramp down

    return {
      stages,
      // Intentionally looser than the default thresholds: a stress test is
      // *expected* to degrade — we're watching where, not asserting it won't.
      thresholds: {
        http_req_duration: ['p(95)<5000'],
        http_req_failed: ['rate<0.2'],
      },
    };
  })(),
};

/**
 * Get k6 `options` for the given profile.
 * Priority: explicit arg > CONFIG_PROFILE env var > 'load'.
 */
export function getConfig(profileName) {
  const name = profileName || __ENV.CONFIG_PROFILE || 'load';
  const profile = PROFILES[name];

  if (!profile) {
    const valid = Object.keys(PROFILES).join(', ');
    console.error(`Invalid CONFIG_PROFILE '${name}'. Valid profiles: ${valid}. Falling back to 'load'.`);
    return PROFILES.load;
  }

  logProfileInfo(name, profile);
  return profile;
}

function logProfileInfo(name, config) {
  console.log(`\n=== Load profile: ${name} ===`);
  if (config.stages) {
    config.stages.forEach((s, i) => console.log(`  stage ${i + 1}: ${s.duration} -> ${s.target} VUs`));
  } else {
    console.log(`  vus: ${config.vus}, duration: ${config.duration}`);
  }
  console.log('');
}

export const profiles = PROFILES;
export const VALID_PROFILES = Object.keys(PROFILES);
export default getConfig;

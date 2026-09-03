export const BASE_URL = (__ENV.BASE_URL || 'https://dev.docs.api.vidrush.ai').replace(/\/+$/, '');

export const THRESHOLDS = {
  http_req_duration: ['p(95)<2000'],
  http_req_failed: ['rate<0.05'],
};

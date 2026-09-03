// Account / identity / billing endpoints — everything scoped to "me" (the
// authenticated user behind the current VU's token) plus team/seat reads.
// All read-only GETs, safe to hammer under load: no credit spend, no writes.
import http from 'k6/http';
import { BASE_URL } from '../config/env.js';
import { authHeaders } from '../utils/tokenPool.js';

const get = (path, name) => http.get(`${BASE_URL}${path}`, { headers: authHeaders(), tags: { name } });

export const verifyAuthToken = () => get('/auth/verify', 'VerifyAuthToken');

export const getCurrentUser = () => get('/users/me', 'GetCurrentUser');
export const getCurrentUserDetailed = () => get('/users/me/detailed', 'GetCurrentUserDetailed');

export const getUserCredits = () => get('/users/me/credits', 'GetUserCredits');
export const getCreditHistory = () => get('/users/me/credits/history', 'GetCreditHistory');
export const getUserDiscounts = () => get('/users/me/discounts', 'GetUserDiscounts');

export const getPayAsYouGoSettings = () => get('/billing/pay-as-you-go/settings', 'GetPayAsYouGoSettings');
export const getUsageReport = () => get('/billing/pay-as-you-go/usage-report', 'GetUsageReport');
export const getBillingSubscriptionPlans = () => get('/billing/subscription-plans', 'GetBillingSubscriptionPlans');

export const listSeats = () => get('/users/me/seats', 'ListSeats');
export const listGrantedSeats = () => get('/users/me/granted-seats', 'ListGrantedSeats');

export const listTeams = () => get('/teams', 'ListTeams');
export const listGrantedTeams = () => get('/users/me/granted-teams', 'ListGrantedTeams');

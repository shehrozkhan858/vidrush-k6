#!/usr/bin/env node
'use strict';

/**
 * Pre-flight check — run this BEFORE a stress run, from a machine that can
 * actually reach the API (VPN / allowlisted network).
 *
 * For each token in tokens.json it reports: who it is, whether it's expired,
 * and what `GET /users/me` actually returns — including whether the body is
 * real JSON or an HTML page (the failure mode that silently passed a
 * status-code-only check on 2026-09-03, see README).
 *
 * Usage:
 *   node utils/verifyTokens.js
 *   BASE_URL=https://some-other-host node utils/verifyTokens.js
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.BASE_URL || 'https://dev.api.vidrush.ai').replace(/\/+$/, '');
const TOKENS_PATH = path.join(__dirname, '..', 'tokens.json');

function decodePayload(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  } catch (e) {
    return null;
  }
}

function looksLikeJson(contentType, body) {
  if ((contentType || '').toLowerCase().includes('json')) return true;
  const trimmed = (body || '').trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

async function main() {
  if (!fs.existsSync(TOKENS_PATH)) {
    console.error(`tokens.json not found at ${TOKENS_PATH}`);
    process.exit(1);
  }

  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  if (!Array.isArray(tokens) || tokens.length === 0) {
    console.error('tokens.json must be a non-empty JSON array of JWT strings');
    process.exit(1);
  }

  console.log(`Verifying ${tokens.length} token(s) against ${BASE_URL}/users/me\n`);

  let usable = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const jwt = tokens[i];
    const payload = decodePayload(jwt);
    const identity = (payload && payload.properties && payload.properties.email) || `token#${i}`;
    const aud = payload ? payload.aud : '?';
    const expired = payload && payload.exp ? Date.now() > payload.exp * 1000 : null;

    let line = `[${i}] ${identity}  (aud: ${aud})`;
    if (expired === true) {
      console.log(`${line}\n     EXPIRED — token expired ${new Date(payload.exp * 1000).toISOString()}\n`);
      continue;
    }

    try {
      const res = await fetch(`${BASE_URL}/users/me`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      });
      const contentType = res.headers.get('content-type') || '';
      const body = await res.text();
      const isJson = looksLikeJson(contentType, body);
      const ok = res.status === 200 && isJson;
      if (ok) usable += 1;

      console.log(line);
      console.log(`     HTTP ${res.status} | ${contentType || 'no content-type'} | body looks like JSON: ${isJson}`);
      console.log(`     ${ok ? 'USABLE' : 'NOT USABLE'} — ${body.slice(0, 160).replace(/\s+/g, ' ')}`);
      console.log('');
    } catch (err) {
      console.log(line);
      console.log(`     REQUEST FAILED — ${err.message}`);
      console.log(`     (if this is a timeout/DNS error, you're probably not on the allowlisted network)\n`);
    }
  }

  console.log(`${usable}/${tokens.length} token(s) usable.`);
  if (usable === 0) {
    console.log('\nNo usable tokens — a stress run now would just measure your auth rejection path.');
    process.exit(2);
  }
  if (usable < tokens.length) {
    console.log('\nSome tokens are unusable; VUs assigned to those will fail. Remove them or replace them before running.');
  }
}

main();

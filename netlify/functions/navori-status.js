'use strict';

// ── Navori Player Status ───────────────────────────────────────────────────
// GET/POST  /.netlify/functions/navori-status?license=DEE9A-91E51-...
//           /.netlify/functions/navori-status?name=Player+Name
//           Spanish aliases: licencia=, nombre=
//
// Returns real-time online/offline status of a Navori digital signage player
// by querying the Navori QL API. Requires a valid Liberty session JWT.
//
// Ported from the Python AWS Lambda handler in navori_status_lambda.py.
// Token is intentionally reset on every invocation (not reused across calls)
// to match the original Lambda's per-invocation reset pattern.

const { appJson }       = require('./lib/http');
const { verifySession } = require('./lib/session');

// ── Config ────────────────────────────────────────────────────────────────
const OFFLINE_THRESHOLD_MINUTES = 15;
const BASE_URL    = (process.env.POPATELIER_NAVORI_BASE_URL || '').replace(/\/$/, '');
const NAVORI_USER = process.env.POPATELIER_NAVORI_USER;
const NAVORI_PASS = process.env.POPATELIER_NAVORI_PASS;

// Module-level token cache — reset to null at the start of every handler
// invocation so each request gets a fresh token (matches Python Lambda reset).
let _token = null;

// ── Auth helpers ──────────────────────────────────────────────────────────
function _getBearer(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  return header.startsWith('Bearer ') ? header.substring(7).trim() : null;
}

// ── Navori API helpers ────────────────────────────────────────────────────
async function _getToken() {
  if (_token) return _token;

  const res = await fetch(`${BASE_URL}/GetToken`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ Login: NAVORI_USER, Password: NAVORI_PASS }),
    signal:  AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Navori GetToken HTTP ${res.status}`);
  const data = await res.json();
  if (data.Status !== 'SUCCESS') throw new Error(`Navori GetToken failed: ${data.Status}`);

  _token = data.Token;
  return _token;
}

async function _getAllPlayers() {
  const token = await _getToken();

  const res = await fetch(`${BASE_URL}/GetPlayers`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Token: token },
    body:    '{}',
    signal:  AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Navori GetPlayers HTTP ${res.status}`);
  const data = await res.json();
  if (data.Status !== 'SUCCESS') throw new Error(`Navori GetPlayers failed: ${data.Status}`);

  return data.PlayerList ?? [];
}

// ── Pure helpers (no I/O) ─────────────────────────────────────────────────

// Normalizes a license string to Navori's canonical format: "DEE9A - 91E51 - ..."
// Accepts with or without spaces, then splits on "-" and rejoins with " - ".
// Exact port of Python's _normalize_license().
function _normalizeLicense(raw) {
  return raw.replace(/\s+/g, '').split('-').filter(Boolean).join(' - ');
}

// Returns how many minutes ago the ISO timestamp occurred (UTC).
// Appends 'Z' when no timezone designator is present so JS treats the
// naive string as UTC — equivalent to Python's replace(tzinfo=None) pattern.
function _minutesAgo(lastNotifyStr) {
  const hasTimezone = /[Z+\-]\d{2}:?\d{2}$/.test(lastNotifyStr);
  const utcStr      = hasTimezone ? lastNotifyStr : lastNotifyStr + 'Z';
  return (Date.now() - new Date(utcStr).getTime()) / 60_000;
}

// ── Core logic ────────────────────────────────────────────────────────────
async function _getPlayerStatus(license, name) {
  const players           = await _getAllPlayers();
  const normalizedLicense = license ? _normalizeLicense(license) : null;
  const searchName        = name    ? name.trim().toLowerCase()   : null;

  for (const p of players) {
    const sn         = p.SerialNumber ?? '';
    const playerName = p.Name         ?? '';

    const matched =
      (normalizedLicense && sn          === normalizedLicense) ||
      (searchName        && playerName.toLowerCase() === searchName);

    if (!matched) continue;

    const last      = p.LastNotify ?? null;
    const mins      = last !== null ? _minutesAgo(last) : null;
    const isOnline  = mins !== null ? mins < OFFLINE_THRESHOLD_MINUTES : false;

    return {
      ok:          true,
      license:     sn,
      name:        playerName,
      online:      isOnline,
      status:      isOnline ? 'online' : 'offline',
      last_notify: last,
      minutes_ago: mins !== null ? Math.round(mins * 10) / 10 : null,
    };
  }

  return {
    ok:    false,
    error: `Player no encontrado (license=${license ?? null}, name=${name ?? null})`,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // 1. JWT authentication — valid Liberty session required.
  const bearer = _getBearer(event);
  if (!bearer) return appJson(401, { ok: false, error: 'Authentication required.' });

  try {
    await verifySession(bearer);
  } catch {
    return appJson(401, { ok: false, error: 'Invalid or expired token.' });
  }

  // 2. Reset token so every invocation fetches a fresh Navori credential.
  _token = null;

  // 3. Parse query parameters (Spanish aliases supported, matching original).
  const p            = event.queryStringParameters || {};
  const licenseInput = p.license  || p.licencia || null;
  const nameInput    = p.name     || p.nombre   || null;

  if (!licenseInput && !nameInput) {
    return appJson(400, { ok: false, error: "Parámetro requerido: 'license' o 'name'" });
  }

  // 4. Query Navori and return result.
  try {
    const result = await _getPlayerStatus(licenseInput, nameInput);
    return appJson(result.ok ? 200 : 404, result);
  } catch (err) {
    console.error('[navori-status]', err.message);
    return appJson(500, { ok: false, error: err.message });
  }
};

'use strict';

const { getDb }   = require('./lib/firebaseAdmin');
const { appJson } = require('./lib/http');

// ── Provider registry ──────────────────────────────────────────────────────
// Keyed by the exact `iss` claim that will appear in the JWT.
// To add a new Identity Provider: uncomment its block and set the env vars.
function buildProviders() {
  const map = {};

  // ── Okta ──
  if (process.env.OKTA_ISSUER) {
    map[process.env.OKTA_ISSUER] = {
      name:     'okta',
      jwksUri:  `${process.env.OKTA_ISSUER}/v1/keys`,
      audience: process.env.OKTA_AUDIENCE || 'api://default',
    };
  }

  // ── Microsoft Entra ID (future) ──
  // if (process.env.ENTRA_ISSUER) {
  //   map[process.env.ENTRA_ISSUER] = {
  //     name:     'entra',
  //     jwksUri:  `${process.env.ENTRA_ISSUER}/discovery/v2.0/keys`,
  //     audience: process.env.ENTRA_CLIENT_ID,
  //   };
  // }

  return map;
}

const PROVIDERS = buildProviders();

// ── Helpers ────────────────────────────────────────────────────────────────
function getBearer(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  return header.startsWith('Bearer ') ? header.substring(7).trim() : null;
}

// Decode JWT payload WITHOUT verification — only to read `iss` and select
// the right verifier. Cryptographic verification always follows.
function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  try {
    const token = getBearer(event);
    if (!token) return appJson(401, { error: 'Missing bearer token.' });

    // 1. Peek at the issuer (unverified) to select the correct JWKS verifier.
    const rawPayload = decodeJwtPayload(token);
    const iss        = rawPayload?.iss || '';
    const provider   = PROVIDERS[iss];

    if (!provider) {
      console.error('[me] Unknown or unconfigured issuer:', iss || '(none)');
      return appJson(401, { error: `Token issuer is not configured on this server.` });
    }

    console.log(`[me] Provider: ${provider.name} | iss: ${iss}`);

    // 2. Cryptographically verify the token with the provider's JWKS endpoint.
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const JWKS = createRemoteJWKSet(new URL(provider.jwksUri));
    const { payload } = await jwtVerify(token, JWKS, {
      issuer:   iss,
      audience: provider.audience,
    });

    // 3. Extract email. Okta trial orgs often set sub = email address directly.
    const sub   = String(payload.sub || '');
    const email = String(payload.email || payload.preferred_username || sub).toLowerCase();

    console.log('[me] Claims extraídos del token:');
    console.log('  payload.email              :', payload.email              || '(vacío)');
    console.log('  payload.preferred_username :', payload.preferred_username  || '(vacío)');
    console.log('  payload.sub                :', sub                        || '(vacío)');
    console.log('  → email resuelto para query:', email                      || '(vacío)');

    // 4. Look up user in Firestore — three fallback strategies.
    const db = getDb();
    let snap;

    if (email) {
      snap = await db.collection('users').where('userName', '==', email).limit(1).get();
      console.log('[me] Attempt 1 (userName ==', email, ') → docs encontrados:', snap.size);

      if (snap.empty) {
        snap = await db.collection('users').where('email', '==', email).limit(1).get();
        console.log('[me] Attempt 2 (email ==', email, ') → docs encontrados:', snap.size);
      }
    }

    if ((!snap || snap.empty) && sub) {
      snap = await db.collection('users').where('oktaExternalId', '==', sub).limit(1).get();
      console.log('[me] Attempt 3 (oktaExternalId ==', sub, ') → docs encontrados:', snap.size);
    }

    if (!snap || snap.empty) {
      console.log('[me] 403 — ningún query encontró al usuario en Firestore.');
      return appJson(403, { active: false, reason: 'User not provisioned in Firestore.' });
    }

    const doc  = snap.docs[0];
    const user = doc.data();

    if (user.active === false) {
      return appJson(403, { active: false, reason: 'User account is inactive.' });
    }

    return appJson(200, {
      active:      true,
      uid:         doc.id,
      email:       user.email,
      role:        user.role        || 'viewer',
      givenName:   user.givenName   || '',
      familyName:  user.familyName  || '',
      displayName: user.displayName || '',
    });

  } catch (err) {
    console.error('[me] Token validation error:', err.message);
    return appJson(401, { error: 'Invalid or expired token.' });
  }
};

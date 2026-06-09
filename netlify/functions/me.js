'use strict';

const { getAuth, getDb } = require('./lib/firebaseAdmin');
const { appJson }        = require('./lib/http');

// ── Provider registry ──────────────────────────────────────────────────────
// Keyed by the exact `iss` claim in the JWT.
//
// Two verification strategies:
//   jwksUri  — asymmetric RS256/ES256, fetched from IdP's JWKS endpoint (OIDC)
//   secret   — symmetric HS256, verified with SESSION_JWT_SECRET (SAML sessions)
function buildProviders() {
  const map = {};

  // ── Okta (OIDC) ──
  if (process.env.OKTA_ISSUER) {
    map[process.env.OKTA_ISSUER] = {
      name:     'okta',
      jwksUri:  `${process.env.OKTA_ISSUER}/v1/keys`,
      audience: process.env.OKTA_AUDIENCE || 'api://default',
    };
  }

  // ── Local sessions (issued after SAML / password-login verification) ──
  // Mirror the fallback in session.js: if SESSION_JWT_ISSUER is not set,
  // tokens are signed with iss 'app://liberty' — register that same value here.
  if (process.env.SESSION_JWT_SECRET) {
    const localIssuer = process.env.SESSION_JWT_ISSUER || 'app://liberty';
    map[localIssuer] = {
      name:     'local',
      secret:   process.env.SESSION_JWT_SECRET,
      audience: 'liberty-app',
    };
  }

  // ── Microsoft Entra ID via OIDC (future) ──
  // if (process.env.ENTRA_ISSUER) {
  //   map[process.env.ENTRA_ISSUER] = {
  //     name:     'entra-oidc',
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
// the correct verifier. Cryptographic verification always follows.
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

    // 1. Peek at the issuer (unverified) to select the correct verifier.
    const rawPayload = decodeJwtPayload(token);
    const iss        = rawPayload?.iss || '';
    const provider   = PROVIDERS[iss];

    if (!provider) {
      console.error('[me] Unknown or unconfigured issuer:', iss || '(none)');
      return appJson(401, { error: 'Token issuer is not configured on this server.' });
    }

    console.log(`[me] Provider: ${provider.name} | iss: ${iss}`);

    // 2. Cryptographically verify the token with the appropriate strategy.
    let payload;
    const { jwtVerify } = await import('jose');

    if (provider.secret) {
      // Symmetric HS256 — our own SAML-backed session JWTs.
      const key = new TextEncoder().encode(provider.secret);
      ({ payload } = await jwtVerify(token, key, {
        issuer:   iss,
        audience: provider.audience,
      }));
    } else {
      // Asymmetric JWKS — external OIDC providers (Okta, future Entra OIDC).
      const { createRemoteJWKSet } = await import('jose');
      const JWKS = createRemoteJWKSet(new URL(provider.jwksUri));
      ({ payload } = await jwtVerify(token, JWKS, {
        issuer:   iss,
        audience: provider.audience,
      }));
    }

    // 3. Extract identity claims.
    const sub     = String(payload.sub || '');
    const isLocal = provider.name === 'local';

    // For local (SAML) tokens, sub is the Firestore doc ID — not an email.
    // For Okta trial orgs, sub IS the email address.
    const email = String(
      payload.email ||
      payload.preferred_username ||
      (!isLocal ? sub : '')
    ).toLowerCase();

    console.log('[me] Claims:');
    console.log('  payload.email              :', payload.email              || '(empty)');
    console.log('  payload.preferred_username :', payload.preferred_username  || '(empty)');
    console.log('  payload.sub                :', sub                        || '(empty)');
    console.log('  → resolved email           :', email                      || '(empty)');

    // 4. Look up user in Firestore — multiple fallback strategies.
    const db = getDb();
    let snap;

    if (email) {
      snap = await db.collection('users').where('userName', '==', email).limit(1).get();
      console.log('[me] Attempt 1 (userName ==', email, ') → docs found:', snap.size);

      if (snap.empty) {
        snap = await db.collection('users').where('email', '==', email).limit(1).get();
        console.log('[me] Attempt 2 (email ==', email, ') → docs found:', snap.size);
      }
    }

    if (!snap || snap.empty) {
      if (isLocal && sub) {
        // Local sessions carry the Firestore doc ID in sub — direct O(1) lookup.
        const docSnap = await db.collection('users').doc(sub).get();
        console.log('[me] Attempt 3 (doc id ==', sub, ') → exists:', docSnap.exists);
        if (docSnap.exists) snap = { empty: false, size: 1, docs: [docSnap] };
      } else if (sub) {
        // OIDC: sub may be the IdP's external user ID.
        snap = await db.collection('users').where('oktaExternalId', '==', sub).limit(1).get();
        console.log('[me] Attempt 3 (oktaExternalId ==', sub, ') → docs found:', snap?.size);
      }
    }

    if (!snap || snap.empty) {
      console.log('[me] 403 — user not found in Firestore.');
      return appJson(403, { active: false, reason: 'User not provisioned in Firestore.' });
    }

    const doc  = snap.docs[0];
    const user = doc.data();

    if (user.active === false) {
      return appJson(403, { active: false, reason: 'User account is inactive.' });
    }

    // Mint a Firebase Custom Token so the client can call
    // firebase.auth().signInWithCustomToken() and satisfy
    // Firestore security rules that require request.auth != null.
    const firebaseToken = await getAuth().createCustomToken(doc.id);

    return appJson(200, {
      active:        true,
      uid:           doc.id,
      email:         user.email,
      role:          user.role        || 'viewer',
      givenName:     user.givenName   || '',
      familyName:    user.familyName  || '',
      displayName:   user.displayName || '',
      firebaseToken,
    });

  } catch (err) {
    console.error('[me] Token validation error:', err.message);
    return appJson(401, { error: 'Invalid or expired token.' });
  }
};

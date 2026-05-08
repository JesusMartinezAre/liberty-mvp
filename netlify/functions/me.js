'use strict';

const { getDb }   = require('./lib/firebaseAdmin');
const { appJson } = require('./lib/http');

function getBearer(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  return header.startsWith('Bearer ') ? header.substring(7).trim() : null;
}

exports.handler = async (event) => {
  try {
    const token = getBearer(event);
    if (!token) return appJson(401, { error: 'Missing bearer token.' });

    // jose is ESM-only — dynamic import works in both CJS and ESM contexts.
    const { createRemoteJWKSet, jwtVerify } = await import('jose');

    const issuer   = process.env.OKTA_ISSUER;
    const audience = process.env.OKTA_AUDIENCE || 'api://default';
    if (!issuer) return appJson(500, { error: 'OKTA_ISSUER env var is not configured.' });

    const JWKS = createRemoteJWKSet(new URL(`${issuer}/v1/keys`));
    const { payload } = await jwtVerify(token, JWKS, { issuer, audience });

    // Okta access tokens: 'email' / 'preferred_username' carry the address.
    // 'sub' is the Okta user ID (e.g. 00u...) — used as a fallback.
    const sub   = String(payload.sub || '');
    // If Okta omits email/preferred_username, treat sub as the email address
    // (Okta trial orgs often send the email directly in sub).
    const email = String(payload.email || payload.preferred_username || sub).toLowerCase();

    console.log('[me] Claims extraídos del token de Okta:');
    console.log('  payload.email              :', payload.email              || '(vacío)');
    console.log('  payload.preferred_username :', payload.preferred_username  || '(vacío)');
    console.log('  payload.sub                :', sub                        || '(vacío)');
    console.log('  → email resuelto para query:', email                      || '(vacío)');

    const db = getDb();
    let snap;

    if (email) {
      // Attempt 1: match against 'userName' (set to email during SCIM provisioning).
      snap = await db.collection('users').where('userName', '==', email).limit(1).get();
      console.log('[me] Attempt 1 (userName ==', email, ') → docs encontrados:', snap.size);

      // Attempt 2: match directly against the 'email' field.
      if (snap.empty) {
        snap = await db.collection('users').where('email', '==', email).limit(1).get();
        console.log('[me] Attempt 2 (email ==', email, ') → docs encontrados:', snap.size);
      }
    }

    // Attempt 3: match by Okta subject ID stored in oktaExternalId during SCIM POST.
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

'use strict';

// ── Password Login ────────────────────────────────────────────────────────────
// POST /api/auth/password-login
//
// Accepts { email, password } as JSON. Looks up the user in Firestore,
// verifies the bcrypt hash, and issues a session JWT via signSession —
// identical token format to the SAML flow so me.js needs no changes.

const { getDb }       = require('./lib/firebaseAdmin');
const { signSession } = require('./lib/session');
const { appJson }     = require('./lib/http');
const bcrypt          = require('bcryptjs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: 'Method not allowed.' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return appJson(400, { error: 'Invalid JSON body.' });
  }

  const email    = (body.email    || '').toLowerCase().trim();
  const password = (body.password || '');

  if (!email || !password) {
    return appJson(400, { error: 'email and password are required.' });
  }

  // One generic error for all credential failures — prevents user enumeration.
  const INVALID = appJson(401, { error: 'Invalid email or password.' });

  try {
    const db = getDb();

    // Mirror the lookup order used by me.js and jit.js.
    let snap = await db.collection('users').where('userName', '==', email).limit(1).get();
    if (snap.empty) {
      snap = await db.collection('users').where('email', '==', email).limit(1).get();
    }

    if (snap.empty) return INVALID;

    const doc  = snap.docs[0];
    const user = doc.data();

    // Inactive users get a distinct 403 (same pattern as saml-callback.js).
    if (user.active === false) {
      return appJson(403, { error: 'Account is inactive. Contact your administrator.' });
    }

    // No hash stored → account not set up for password auth.
    if (!user.passwordHash) return INVALID;

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return INVALID;

    const token = await signSession({
      sub:         doc.id,
      email:       user.email || email,
      provider:    'password',
      role:        user.role        || 'viewer',
      givenName:   user.givenName   || '',
      familyName:  user.familyName  || '',
      displayName: user.displayName || email,
    });

    console.log('[password-login] Session issued for:', email);
    return appJson(200, { token });

  } catch (err) {
    console.error('[password-login] Error:', err.message);
    return appJson(500, { error: 'Internal server error.' });
  }
};

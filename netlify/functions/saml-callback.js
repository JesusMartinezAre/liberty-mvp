'use strict';

// ── SAML Assertion Consumer Service (ACS) ─────────────────────────────────
// POST /api/auth/saml/callback
//
// Entra ID POSTs a SAMLResponse (URL-encoded form body) here after the user
// authenticates. This handler:
//   1. Parses the form body
//   2. Validates the SAMLResponse XML signature with the IdP certificate
//   3. Normalises Entra's attribute claims into { email, givenName, ... }
//   4. JIT-provisions the user in Firestore if they don't exist yet
//   5. Issues a signed session JWT
//   6. 302 redirects to /auth/saml-complete.html?t=<jwt>
//      (saml-complete.html scrubs the token from the URL bar and stores it)

const { getSaml }      = require('./lib/saml');
const { jitProvision } = require('./lib/jit');
const { signSession }  = require('./lib/session');
const { getDb }        = require('./lib/firebaseAdmin');

// ── Helpers ────────────────────────────────────────────────────────────────

function redirect(location) {
  return {
    statusCode: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
    body: '',
  };
}

// Parse an application/x-www-form-urlencoded POST body into a plain object.
//
// WHY NOT URLSearchParams:
//   URLSearchParams follows the HTML spec and converts every bare `+` to a
//   space character.  A SAML SAMLResponse is base64-encoded XML — base64 uses
//   `+` as a valid alphabet character.  If the IdP sends (or Netlify transmits)
//   any `+` that isn't percent-encoded as `%2B`, URLSearchParams silently
//   corrupts the value and the XML signature no longer matches the document.
//
//   decodeURIComponent leaves a raw `+` as `+` and only decodes %-sequences,
//   so `%2B` → `+` and `+` → `+`.  Either way the base64 survives intact.
function parseFormBody(body, isBase64) {
  // Step 1 — undo Netlify's base64 envelope when present.
  const raw = isBase64
    ? Buffer.from(body || '', 'base64').toString('utf8')
    : (body || '');

  console.log('[saml-callback] isBase64Encoded:', isBase64);
  console.log('[saml-callback] raw body length:', raw.length);

  // Step 2 — split into key=value pairs and percent-decode each side.
  //           We deliberately do NOT replace `+` with space before decoding.
  const result = {};
  for (const part of raw.split('&')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    try {
      const k = decodeURIComponent(part.slice(0, i));
      const v = decodeURIComponent(part.slice(i + 1));
      result[k] = v;
    } catch {
      // Malformed percent-sequence — skip the pair rather than crash.
    }
  }
  return result;
}

// Normalise Microsoft Entra ID SAML attribute claims into a standard object.
// Entra uses long XML namespace URIs for attribute names; we try the most
// common ones in order.
function normalizeProfile(profile) {
  function claim(...names) {
    for (const n of names) {
      if (profile[n]) return String(profile[n]);
    }
    return '';
  }

  const email = claim(
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
    'http://schemas.microsoft.com/identity/claims/userprincipalname',
    'email',
  ) || (profile.nameID || '');

  const givenName = claim(
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    'givenName',
    'firstName',
  );

  const familyName = claim(
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
    'familyName',
    'lastName',
    'sn',
  );

  const displayName = claim(
    'http://schemas.microsoft.com/identity/claims/displayname',
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/displayname',
    'displayName',
    'name',
  ) || `${givenName} ${familyName}`.trim() || email;

  return {
    email:       email.toLowerCase(),
    givenName,
    familyName,
    displayName,
    externalId:  profile.nameID || null,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed.' };
  }

  let saml;
  try {
    saml = getSaml();
  } catch (err) {
    console.error('[saml-callback] Config error:', err.message);
    return redirect('/auth/login.html?error=saml_not_configured');
  }

  try {
    const body = parseFormBody(event.body, event.isBase64Encoded);

    if (!body.SAMLResponse) {
      console.error('[saml-callback] Missing SAMLResponse in POST body.');
      return redirect('/auth/login.html?error=saml_missing_response');
    }

    // ── 1. Validate the SAMLResponse XML signature ──────────────────────────
    const { profile } = await saml.validatePostResponseAsync(body);

    if (!profile) {
      console.error('[saml-callback] Empty profile after validation.');
      return redirect('/auth/login.html?error=saml_invalid');
    }

    console.log('[saml-callback] Raw profile keys:', Object.keys(profile).join(', '));

    // ── 2. Normalise claims ─────────────────────────────────────────────────
    const identity = normalizeProfile(profile);
    console.log('[saml-callback] Resolved email:', identity.email);

    if (!identity.email) {
      console.error('[saml-callback] No email found in SAML assertion.');
      return redirect('/auth/login.html?error=saml_no_email');
    }

    // ── 3. JIT provision ────────────────────────────────────────────────────
    const db = getDb();
    const { docId, user } = await jitProvision(db, {
      ...identity,
      provider: 'entra-saml',
    });

    if (user.active === false) {
      console.warn('[saml-callback] Account inactive:', docId);
      return redirect('/auth/login.html?error=account_inactive');
    }

    // ── 4. Issue session JWT ────────────────────────────────────────────────
    const token = await signSession({
      sub:         docId,
      email:       identity.email,
      provider:    'entra-saml',
      role:        user.role        || 'viewer',
      givenName:   user.givenName   || identity.givenName,
      familyName:  user.familyName  || identity.familyName,
      displayName: user.displayName || identity.displayName,
    });

    // ── 5. Redirect to saml-complete.html — it scrubs the URL then stores ───
    return redirect(`/auth/saml-complete.html?t=${encodeURIComponent(token)}`);

  } catch (err) {
    console.error('[saml-callback] Unhandled error:', err.message, err.stack);
    return redirect('/auth/login.html?error=saml_failed');
  }
};

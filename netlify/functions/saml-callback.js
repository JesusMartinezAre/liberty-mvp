'use strict';

// ── SAML Assertion Consumer Service (ACS) — Multi-Tenant ──────────────────
// POST /api/auth/saml/callback
//
// Handles both SP-initiated and IdP-initiated SAML flows.
//
// Tenant resolution — two-layer strategy:
//   Primary   — pre-parse the SAMLResponse XML to extract <Issuer>; query
//               sso_configs where idpEntityId == issuer.  Works for both flows
//               regardless of whether a RelayState is present.
//   Secondary — RelayState may carry the tenantDomain set by saml-initiate.js
//               but is not used as an authoritative source of tenant identity.
//
// InResponseTo replay prevention is handled statelessly via Firestore
// (saml_requests collection) through node-saml's cacheProvider interface
// configured in lib/saml.js. Netlify Functions share no in-memory session state.

const { getSamlForIssuer } = require('./lib/saml');
const { jitProvision }     = require('./lib/jit');
const { signSession }      = require('./lib/session');
const { getDb }            = require('./lib/firebaseAdmin');

const SAML_ROLE_CLAIM = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';
const ALLOWED_ROLES   = new Set(['super_admin', 'admin', 'viewer']);

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

// Pre-parse the SAMLResponse (without signature verification) to extract the
// <Issuer> element. Used only for tenant resolution — all cryptographic
// validation happens afterward inside saml.validatePostResponseAsync().
//
// Regex is intentional: Node.js has no built-in XML parser and adding a
// dependency for one attribute read is unnecessary. SAML Issuer values are
// URIs — no nested elements, no HTML entities to handle.
function extractIssuer(samlResponseBase64) {
  try {
    const xml   = Buffer.from(samlResponseBase64, 'base64').toString('utf8');
    const match = xml.match(/<(?:[A-Za-z0-9]+:)?Issuer[^>]*>([^<]+)<\/(?:[A-Za-z0-9]+:)?Issuer>/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
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

  // Extract App Role claim — only accept values on the whitelist.
  //
  // Entra sends the role under different keys depending on how the claim was configured:
  //   - URI form: when App Roles are emitted natively (no manual claim setup needed)
  //   - Short form 'role': when manually added in Attributes & Claims → Name: "role"
  //
  // We try both so either Entra configuration works without code changes.
  const rawRole = profile[SAML_ROLE_CLAIM] ?? profile['role'] ?? null;

  console.log('[saml-callback] role claim raw value:', JSON.stringify(rawRole));

  const roleValue = rawRole
    ? (Array.isArray(rawRole) ? rawRole[0] : String(rawRole)).trim().toLowerCase()
    : null;
  const samlRole = roleValue && ALLOWED_ROLES.has(roleValue) ? roleValue : null;

  if (roleValue && !samlRole) {
    console.warn('[saml-callback] Role claim received but not in whitelist:', roleValue);
  }

  return {
    email:       email.toLowerCase(),
    givenName,
    familyName,
    displayName,
    externalId:  profile.nameID || null,
    samlRole,
  };
}

// ── Handler ────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed.' };
  }

  try {
    const body = parseFormBody(event.body, event.isBase64Encoded);

    if (!body.SAMLResponse) {
      console.error('[saml-callback] Missing SAMLResponse in POST body.');
      return redirect('/auth/login.html?error=saml_missing_response');
    }

    // ── 1. Resolve tenant from the SAMLResponse <Issuer> ───────────────────
    // The Issuer is extracted before signature validation so we know which
    // tenant's IdP certificate to use.  The pre-parse is intentionally
    // unauthenticated — the SAML library re-validates the issuer inside
    // validatePostResponseAsync() once the correct config is loaded.
    const issuer = extractIssuer(body.SAMLResponse);
    if (!issuer) {
      console.error('[saml-callback] Could not extract <Issuer> from SAMLResponse.');
      return redirect('/auth/login.html?error=saml_invalid');
    }

    const tenant = await getSamlForIssuer(issuer);
    if (!tenant) {
      console.error('[saml-callback] No enabled sso_configs entry for issuer:', issuer);
      return redirect('/auth/login.html?error=saml_tenant_not_found');
    }

    const { saml, domain } = tenant;
    console.log('[saml-callback] Resolved tenant:', domain, '| issuer:', issuer);

    // ── 2. Validate the SAMLResponse XML signature ──────────────────────────
    const { profile } = await saml.validatePostResponseAsync(body);

    if (!profile) {
      console.error('[saml-callback] Empty profile after validation for tenant:', domain);
      return redirect('/auth/login.html?error=saml_invalid');
    }

    console.log('[saml-callback] Raw profile keys:', Object.keys(profile).join(', '));
    console.log('[saml-callback] Raw profile:', JSON.stringify(profile));

    // ── 3. Normalise claims ─────────────────────────────────────────────────
    const identity = normalizeProfile(profile);
    console.log('[saml-callback] Resolved email:', identity.email, '| domain:', domain);

    if (!identity.email) {
      console.error('[saml-callback] No email found in SAML assertion for tenant:', domain);
      return redirect('/auth/login.html?error=saml_no_email');
    }

    // ── 4. JIT provision ────────────────────────────────────────────────────
    const db          = getDb();
    const defaultRole = tenant.config.defaultRole || 'viewer';

    console.log('[saml-callback] samlRole:', identity.samlRole, '| defaultRole:', defaultRole);

    const { docId, user } = await jitProvision(db, {
      ...identity,
      provider:     'entra-saml',
      overrideRole: identity.samlRole,
      defaultRole,
    });

    if (user.active === false) {
      console.warn('[saml-callback] Account inactive:', docId, '| domain:', domain);
      return redirect('/auth/login.html?error=account_inactive');
    }

    // Stamp tenantDomain for multi-tenant user isolation.
    // Conditional update avoids clobbering users already set via SCIM provisioning.
    if (!user.tenantDomain) {
      await db.collection('users').doc(docId).update({ tenantDomain: domain });
    }

    // ── 5. Issue session JWT ────────────────────────────────────────────────
    const token = await signSession({
      sub:         docId,
      email:       identity.email,
      provider:    'entra-saml',
      role:        user.role        || 'viewer',
      givenName:   user.givenName   || identity.givenName,
      familyName:  user.familyName  || identity.familyName,
      displayName: user.displayName || identity.displayName,
    });

    // ── 6. Redirect to saml-complete.html — it scrubs the URL then stores ───
    return redirect(`/auth/saml-complete.html?t=${encodeURIComponent(token)}`);

  } catch (err) {
    console.error('[saml-callback] Unhandled error:', err.message, err.stack);
    return redirect('/auth/login.html?error=saml_failed');
  }
};

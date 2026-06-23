'use strict';

// ── SCIM Bearer Token Authentication — Dual-Hash Strategy ────────────────────
//
// Verification is a deliberate two-phase process:
//
//   Phase 1 — O(1) Firestore index lookup via SHA-256
//     SHA-256 is deterministic: the same token always produces the same digest,
//     so it can be stored as a Firestore field and queried with a single indexed
//     read.  This replaces the linear bcrypt scan used in the SQL reference
//     project (which was O(n) over all tenants).
//
//   Phase 2 — bcrypt.compare() as the final cryptographic gate
//     SHA-256 narrows the search to exactly one candidate document.  bcrypt then
//     confirms that the plaintext token actually produced that stored hash.
//     This provides defence-in-depth: if a SHA-256 pre-image were somehow
//     extracted from the database, the bcrypt layer would still block the attack.
//
// Why not bcrypt-only (like the SQL reference project)?
//   bcrypt uses a random salt, so the same plaintext produces a DIFFERENT digest
//   on every call.  You cannot query Firestore (or any DB) by a bcrypt hash —
//   you would have to fetch every tenant document and call bcrypt.compare()
//   against each one: O(n).  The dual-hash strategy turns this NoSQL constraint
//   into an advantage: O(1) lookup + O(1) bcrypt confirm = constant time total.
//
// ── Firestore Collection Schemas ─────────────────────────────────────────────
//
// sso_configs/{domain}          ← document ID is the tenant email domain
// {
//   domain:             string,   "libertycoke.com"
//   enabled:            boolean,  false = kill switch, rejects all auth
//   provider:           string,   "entra-saml"
//
//   // SCIM dual-hash auth
//   scimTokenSha256:    string,   SHA-256 hex of raw bearer token (index field)
//   scimTokenBcrypt:    string,   bcrypt hash of raw bearer token (verify field)
//   scimSource:         string,   "entra" | "okta"
//
//   // SAML IdP config (used by saml-initiate / saml-callback)
//   tenantId:           string,   Azure AD tenant GUID
//   idpEntityId:        string,   IdP Issuer URI — "https://sts.windows.net/{tenantId}/"
//                                 Required for ACS tenant resolution (both flows).
//   entityId:           string,   SP Entity ID URL (or set ENTRA_SP_ENTITY_ID env var)
//   acsUrl:             string,   Assertion Consumer Service URL (or set ENTRA_ACS_URL env var)
//   idpCert:            string,   IdP X.509 cert — PEM body only, no headers
//   signatureAlgorithm: string,   "sha256"  (configure Azure portal to match)
//
//   createdAt:          Timestamp
//   updatedAt:          Timestamp
// }
//
// users/{firestoreDocId}
// {
//   id:               string,   Firestore doc ID (same value, for convenience)
//   email:            string,
//   userName:         string,   primary login identifier (usually = email)
//   givenName:        string,
//   familyName:       string,
//   displayName:      string,
//   role:             string,   "super_admin" | "admin" | "viewer"
//   active:           boolean,  false = soft-delete, never hard-delete
//   passwordHash:     string?,  present only for local password accounts
//   source:           string,   "entra-saml" | "entra-scim" | "okta-scim" | "local"
//   tenantDomain:     string?,  e.g. "libertycoke.com" — set for SSO users
//   entraExternalId:  string?,  Entra object ID (for SCIM reconciliation)
//   oktaExternalId:   string?,
//   groups:           string[],
//   createdAt:        Timestamp
//   updatedAt:        Timestamp
//   lastProvisionedAt:Timestamp?
// }
//
// saml_requests/{inResponseToId}   ← state store for SP-initiated flow
// {
//   id:         string,     the AuthnRequest ID echoed back as InResponseTo
//   domain:     string,     tenant domain resolved at initiation time
//   email:      string?,    login hint used (if any)
//   createdAt:  Timestamp,
//   expiresAt:  Timestamp,  createdAt + 5 minutes — TTL prevents replay
//   consumed:   boolean,    true once the ACS has processed this request
// }

const crypto    = require('crypto');
const bcrypt    = require('bcryptjs');
const { getDb } = require('./firebase');

const SSO_CONFIGS = 'sso_configs';

// ── Helpers (exported so token-generator.js and tests use identical logic) ────

/**
 * Return the lowercase hex SHA-256 digest of a token string.
 * Used as the indexed lookup field (scimTokenSha256) in sso_configs.
 *
 * @param {string} token
 * @returns {string}  64-character lowercase hex string
 */
function sha256Hex(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Extract the raw bearer value from event.headers.
 * Accepts "Bearer <token>" (RFC 6750) and bare-token formats.
 * Checks both cases because Netlify Dev (local) does not always normalise
 * header keys to lowercase the way the production CDN runtime does.
 *
 * @param {Record<string, string>} headers
 * @returns {string|null}
 */
function extractBearer(headers) {
  const raw = headers['authorization'] || headers['Authorization'] || '';
  if (!raw) return null;
  const value = raw.toLowerCase().startsWith('bearer ')
    ? raw.slice(7).trim()
    : raw.trim();
  return value || null;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Authenticate an inbound SCIM request against sso_configs.
 *
 * Phase 1 — O(1) indexed Firestore read keyed on SHA-256(token).
 * Phase 2 — bcrypt.compare(token, doc.scimTokenBcrypt) as final gate.
 *
 * All failure paths return null with a server-side log line.
 * The caller is responsible for returning 401 SCIM error to the client.
 *
 * @param {Record<string, string>} headers  event.headers from Netlify handler
 * @returns {Promise<{ domain: string, source: string, config: object }|null>}
 */
async function authenticateScim(headers) {
  // ── Step 1: extract bearer ────────────────────────────────────────────────
  const token = extractBearer(headers);
  if (!token) {
    console.warn('[scim-auth] Request is missing the Authorization header.');
    return null;
  }

  // ── Step 2: SHA-256 index lookup (O(1)) ───────────────────────────────────
  // Query only by scimTokenSha256 (single-field index — Firestore creates
  // these automatically; no manual index.json entry required).
  // The enabled check is done in code after fetching to avoid the composite
  // index requirement that a .where('enabled', '==', true) filter would add.
  const sha256 = sha256Hex(token);
  const db     = getDb();

  let snap;
  try {
    snap = await db
      .collection(SSO_CONFIGS)
      .where('scimTokenSha256', '==', sha256)
      .limit(1)
      .get();
  } catch (err) {
    console.error('[scim-auth] Firestore lookup error:', err.message);
    return null;
  }

  if (snap.empty) {
    console.warn('[scim-auth] No sso_configs document matched the SHA-256 hash.');
    return null;
  }

  const doc    = snap.docs[0];
  const config = doc.data();

  // Disabled tenants are rejected without revealing whether the token exists.
  if (config.enabled === false) {
    console.warn('[scim-auth] Tenant is disabled:', doc.id);
    return null;
  }

  // ── Step 3: bcrypt final verification ────────────────────────────────────
  // SHA-256 found the candidate; bcrypt confirms the plaintext.
  // This is the cryptographic gate — a SHA-256 pre-image alone is not enough.
  if (!config.scimTokenBcrypt) {
    console.error('[scim-auth] sso_configs document is missing scimTokenBcrypt:', doc.id);
    return null;
  }

  let valid;
  try {
    valid = await bcrypt.compare(token, config.scimTokenBcrypt);
  } catch (err) {
    console.error('[scim-auth] bcrypt.compare error for tenant:', doc.id, err.message);
    return null;
  }

  if (!valid) {
    // SHA-256 matched but bcrypt did not — most likely a data integrity problem
    // (the two hashes in the document were not generated from the same token).
    console.error('[scim-auth] SHA-256 matched but bcrypt verification failed for tenant:', doc.id);
    return null;
  }

  console.log('[scim-auth] Authenticated tenant:', doc.id, '| source:', config.scimSource || 'entra');

  return {
    domain: doc.id,                       // e.g. "libertycoke.com"
    source: config.scimSource || 'entra', // "entra" | "okta"
    config,                               // full sso_configs document data
  };
}

module.exports = { authenticateScim, sha256Hex, extractBearer };

'use strict';

// Multi-tenant SAML factory.
// Builds SAML instances dynamically from sso_configs documents in Firestore.
//
// Required sso_configs fields for SAML:
//   idpSsoUrl          "Login URL" from the IdP (where we redirect the user to authenticate).
//                      Falls back to the Entra-standard URL computed from tenantId.
//   idpEntityId        "Entra Identifier" / IdP Issuer URI from the IdP.
//                      Falls back to "https://sts.windows.net/{tenantId}/" if tenantId is set.
//   idpCert            IdP X.509 certificate — any format accepted (raw base64, PEM with
//                      headers, or base64url). formatCert() normalises before use.
//   signatureAlgorithm "sha256" — must match the Azure portal signing algorithm setting.
//   entityId           SP Entity ID URL  (fallback: ENTRA_SP_ENTITY_ID env var)
//   acsUrl             ACS callback URL  (fallback: ENTRA_ACS_URL env var)
//   tenantId           Azure AD tenant GUID — optional if idpSsoUrl and idpEntityId are explicit.

const { SAML }  = require('@node-saml/node-saml');
const { getDb } = require('../_shared/firebase');

const SSO_CONFIGS   = 'sso_configs';
const SAML_REQUESTS = 'saml_requests';
const CACHE_TTL_MS  = 60 * 60 * 1000;

// Per-domain instance cache: domain -> { saml: SAML, config: object, cachedAt: number }
const _instanceCache = new Map();

// ── Firestore cacheProvider ────────────────────────────────────────────────
// Implements the node-saml CacheProvider interface using Firestore so that
// AuthnRequest IDs survive across cold starts and concurrent function instances.
//
// node-saml calls:
//   saveAsync(key, value) -- when generating an AuthnRequest
//   getAsync(key)         -- at ACS to verify InResponseTo is recognised
//   removeAsync(key)      -- after validation to prevent replay
//
// validateInResponseTo: 'ifPresent' activates this only for SP-initiated flows.
function buildCacheProvider() {
  const db = getDb();

  return {
    async saveAsync(key, value) {
      try {
        await db.collection(SAML_REQUESTS).doc(key).set({
          value,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        });
        return value;
      } catch (err) {
        console.error('[saml:cache] saveAsync failed for key:', key, err.message);
        return null;
      }
    },

    async getAsync(key) {
      try {
        const snap = await db.collection(SAML_REQUESTS).doc(key).get();
        if (!snap.exists) return null;
        const data = snap.data();
        if (data.expiresAt.toDate() < new Date()) {
          db.collection(SAML_REQUESTS).doc(key).delete().catch(() => {});
          return null;
        }
        return data.value;
      } catch (err) {
        console.error('[saml:cache] getAsync failed for key:', key, err.message);
        return null;
      }
    },

    async removeAsync(key) {
      try {
        await db.collection(SAML_REQUESTS).doc(key).delete();
        return key;
      } catch (err) {
        console.error('[saml:cache] removeAsync failed for key:', key, err.message);
        return null;
      }
    },
  };
}

// ── Certificate normaliser ─────────────────────────────────────────────────
// Accepts idpCert in any format the Azure / Entra portal provides:
//   - Raw base64  (continuous string, no headers)  -- most common paste
//   - Full PEM    (with -----BEGIN/END CERTIFICATE----- headers)
//   - base64url   (uses - and _ instead of + and /)
//
// The Azure portal clipboard and Firestore web console can inject invisible
// Unicode characters that node-saml's internal strip does not catch, causing
// the "idpCert is not in PEM format or in base64 format" error at runtime.
//
// Steps:
//   1. Strip PEM headers/footers
//   2. Remove all non-printable-ASCII characters (catches NBSP, zero-width
//      space, and any other invisible Unicode that bypasses normal trim)
//   3. Strip remaining printable whitespace (spaces, tabs)
//   4. Normalise base64url to standard base64 (- -> +, _ -> /)
//   5. Validate against the standard base64 alphabet
//   6. Wrap in canonical PEM with 64-char lines
//
// Output: canonical PEM that node-saml v5 unconditionally accepts.
function formatCert(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('[saml] idpCert is missing or not a string');
  }

  // Step 1: strip PEM headers / footers.
  let body = raw
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '');

  // Step 2: remove every character outside printable ASCII (U+0020..U+007E).
  // This catches U+00A0 (NBSP), U+200B (zero-width space), U+2028 (line sep),
  // and any other invisible Unicode that \s does not cover.
  // eslint-disable-next-line no-control-regex
  body = body.replace(/[^\x20-\x7E]/g, '');

  // Step 3: strip remaining printable whitespace (spaces, tabs, line breaks).
  body = body.replace(/\s/g, '');

  if (!body) {
    throw new Error('[saml] idpCert is empty after stripping headers');
  }

  // Step 4: normalise base64url to standard base64.
  body = body.replace(/-/g, '+').replace(/_/g, '/');

  // Step 5: validate -- only standard base64 characters may remain.
  if (!/^[A-Za-z0-9+/=]*$/.test(body)) {
    throw new Error(
      '[saml] idpCert contains invalid characters after normalisation -- ' +
      're-paste from the Azure portal Certificate (Base64) download.',
    );
  }

  // Step 6: wrap in canonical PEM with 64-char lines.
  const lines = body.match(/.{1,64}/g) || [];
  return '-----BEGIN CERTIFICATE-----\n' + lines.join('\n') + '\n-----END CERTIFICATE-----';
}

// ── Build SAML instance from an sso_configs document ──────────────────────
function buildSamlInstance(config) {
  const tenantId = config.tenantId;
  const entityId = config.entityId || process.env.ENTRA_SP_ENTITY_ID;
  const acsUrl   = config.acsUrl   || process.env.ENTRA_ACS_URL;
  const sigAlg   = config.signatureAlgorithm || 'sha256';

  if (!acsUrl)         throw new Error('[saml] acsUrl not set in sso_configs or ENTRA_ACS_URL env var');
  if (!entityId)       throw new Error('[saml] entityId not set in sso_configs or ENTRA_SP_ENTITY_ID env var');
  if (!config.idpCert) throw new Error('[saml] sso_configs missing required field: idpCert');

  const idpCert = formatCert(config.idpCert);

  const entryPoint = config.idpSsoUrl ||
    (tenantId ? `https://login.microsoftonline.com/${tenantId}/saml2` : null);
  if (!entryPoint) throw new Error('[saml] sso_configs requires idpSsoUrl (or tenantId for Entra auto-URL)');

  const idpEntityId = config.idpEntityId ||
    (tenantId ? `https://sts.windows.net/${tenantId}/` : null);
  if (!idpEntityId) throw new Error('[saml] sso_configs requires idpEntityId (or tenantId for Entra auto-URL)');

  return new SAML({
    callbackUrl: acsUrl,
    issuer:      entityId,
    entryPoint,
    idpIssuer:   idpEntityId,
    idpCert,
    wantAssertionsSigned:         true,
    signatureAlgorithm:           sigAlg,
    digestAlgorithm:              sigAlg,
    disableRequestedAuthnContext: true,
    acceptedClockSkewMs:          -1,
    validateInResponseTo:         'ifPresent',
    cacheProvider:                buildCacheProvider(),
  });
}

// ── Public: resolve by tenant domain ──────────────────────────────────────
// O(1) Firestore document read keyed on the tenant domain.
// Used by saml-initiate.js (SP-initiated flow).
async function getSamlForDomain(domain) {
  if (!domain) return null;
  const d = domain.toLowerCase().trim();

  const cached = _instanceCache.get(d);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { saml: cached.saml, config: cached.config, domain: d };
  }

  const db   = getDb();
  const snap = await db.collection(SSO_CONFIGS).doc(d).get();

  if (!snap.exists) {
    console.warn('[saml] No sso_configs document for domain:', d);
    return null;
  }

  const config = snap.data();
  if (config.enabled === false) {
    console.warn('[saml] Tenant is disabled:', d);
    return null;
  }

  const saml = buildSamlInstance(config);
  _instanceCache.set(d, { saml, config, cachedAt: Date.now() });

  return { saml, config, domain: d };
}

// ── Public: resolve by IdP Entity ID ──────────────────────────────────────
// Queries sso_configs where idpEntityId == issuer.
// For Entra ID: issuer == "https://sts.windows.net/{tenantId}/"
//
// Used by saml-callback.js for both SP-initiated and IdP-initiated flows.
async function getSamlForIssuer(issuer) {
  if (!issuer) return null;

  const db   = getDb();
  const snap = await db
    .collection(SSO_CONFIGS)
    .where('idpEntityId', '==', issuer)
    .limit(1)
    .get();

  if (snap.empty) {
    console.warn('[saml] No sso_configs document for idpEntityId:', issuer);
    return null;
  }

  const doc    = snap.docs[0];
  const config = doc.data();

  if (config.enabled === false) {
    console.warn('[saml] Tenant is disabled:', doc.id);
    return null;
  }

  const cached = _instanceCache.get(doc.id);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { saml: cached.saml, config: cached.config, domain: doc.id };
  }

  const saml = buildSamlInstance(config);
  _instanceCache.set(doc.id, { saml, config, cachedAt: Date.now() });

  return { saml, config, domain: doc.id };
}

// ── Backward-compatible getSaml() ─────────────────────────────────────────
// Used by saml-metadata.js which only calls generateServiceProviderMetadata().
function getSaml() {
  const { ENTRA_IDP_CERT } = require('./secrets');
  return buildSamlInstance({
    tenantId:           process.env.ENTRA_TENANT_ID,
    entityId:           process.env.ENTRA_SP_ENTITY_ID,
    acsUrl:             process.env.ENTRA_ACS_URL,
    idpCert:            ENTRA_IDP_CERT,
    signatureAlgorithm: process.env.ENTRA_SIGNATURE_ALG || 'sha256',
  });
}

function resetCache() { _instanceCache.clear(); }
function resetSaml()  { resetCache(); }

module.exports = { getSamlForDomain, getSamlForIssuer, getSaml, resetSaml, resetCache };

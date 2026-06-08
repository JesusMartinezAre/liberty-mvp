'use strict';

// ── Multi-Tenant SAML Factory ──────────────────────────────────────────────
// Replaces the single-tenant singleton. Builds SAML instances dynamically
// from sso_configs documents in Firestore.
//
// Required sso_configs fields for SAML:
//   idpSsoUrl          "Login URL" from the IdP — where we redirect the user to authenticate.
//                      Falls back to the Entra-standard URL computed from tenantId.
//   idpEntityId        "Entra Identifier" / IdP Issuer URI from the IdP.
//                      Falls back to "https://sts.windows.net/{tenantId}/" if tenantId is set.
//   idpCert            IdP X.509 certificate, PEM body only (no -----BEGIN/END lines)
//   signatureAlgorithm "sha256" — must match the Azure portal signing algorithm setting
//   entityId           SP Entity ID URL  (fallback: ENTRA_SP_ENTITY_ID env var)
//   acsUrl             ACS callback URL  (fallback: ENTRA_ACS_URL env var)
//   tenantId           Azure AD tenant GUID — optional if idpSsoUrl and idpEntityId are explicit

const { SAML }  = require('@node-saml/node-saml');
const { getDb } = require('../_shared/firebase');

const SSO_CONFIGS   = 'sso_configs';
const SAML_REQUESTS = 'saml_requests';
const CACHE_TTL_MS  = 60 * 60 * 1000; // 1 hour

// Per-domain instance cache: domain → { saml: SAML, config: object, cachedAt: number }
// Prevents rebuilding the SAML instance on every warm-function request.
// TTL ensures Firestore config changes propagate within an hour.
const _instanceCache = new Map();

// ── Firestore cacheProvider ────────────────────────────────────────────────
// Implements the node-saml CacheProvider interface using Firestore so that
// AuthnRequest IDs survive across cold starts and concurrent function instances.
// Netlify Functions share no in-memory state — Firestore is the only safe store.
//
// node-saml calls:
//   saveAsync(key, value) — when generating an AuthnRequest
//   getAsync(key)         — at ACS to verify InResponseTo is recognised
//   removeAsync(key)      — after validation to prevent replay
//
// validateInResponseTo: 'ifPresent' activates this only for SP-initiated flows
// (SAMLResponse carries InResponseTo). IdP-initiated flows skip it silently.
function buildCacheProvider() {
  const db = getDb();

  return {
    async saveAsync(key, value) {
      try {
        await db.collection(SAML_REQUESTS).doc(key).set({
          value,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5-minute TTL
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
        // Enforce TTL in code — Firestore TTL policies have multi-minute latency.
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

// ── Build SAML instance from an sso_configs document ──────────────────────
function buildSamlInstance(config) {
  const tenantId = config.tenantId;
  const entityId = config.entityId || process.env.ENTRA_SP_ENTITY_ID;
  const acsUrl   = config.acsUrl   || process.env.ENTRA_ACS_URL;
  const idpCert  = config.idpCert;
  const sigAlg   = config.signatureAlgorithm || 'sha256';

  if (!acsUrl)   throw new Error('[saml] acsUrl not set in sso_configs or ENTRA_ACS_URL env var');
  if (!entityId) throw new Error('[saml] entityId not set in sso_configs or ENTRA_SP_ENTITY_ID env var');
  if (!idpCert)  throw new Error('[saml] sso_configs missing required field: idpCert');

  // idpSsoUrl — the "Login URL" the IdP gives you. Stored explicitly so the
  // schema is provider-agnostic. Falls back to the Entra-standard URL computed
  // from tenantId for documents that were created before this field existed.
  const entryPoint = config.idpSsoUrl ||
    (tenantId ? `https://login.microsoftonline.com/${tenantId}/saml2` : null);
  if (!entryPoint) throw new Error('[saml] sso_configs requires idpSsoUrl (or tenantId for Entra auto-URL)');

  // idpEntityId — the "Entra Identifier" / IdP Issuer URI the IdP gives you.
  // Falls back to the Entra-standard URI computed from tenantId.
  const idpEntityId = config.idpEntityId ||
    (tenantId ? `https://sts.windows.net/${tenantId}/` : null);
  if (!idpEntityId) throw new Error('[saml] sso_configs requires idpEntityId (or tenantId for Entra auto-URL)');

  return new SAML({
    // ── Service Provider (our app) ────────────────────────────────────────
    callbackUrl: acsUrl,
    issuer:      entityId,

    // ── Identity Provider ─────────────────────────────────────────────────
    entryPoint,
    idpIssuer:   idpEntityId,
    idpCert,

    // ── Assertion requirements ────────────────────────────────────────────
    wantAssertionsSigned:         true,
    signatureAlgorithm:           sigAlg,
    digestAlgorithm:              sigAlg,

    // ── Entra ID compatibility ────────────────────────────────────────────
    // Entra does not include a RequestedAuthnContext in its responses.
    disableRequestedAuthnContext: true,
    // Disable clock-skew enforcement to prevent false rejections in
    // environments where the function clock may briefly lag.
    acceptedClockSkewMs:          -1,

    // ── Stateless InResponseTo validation via Firestore ───────────────────
    // 'ifPresent' = validate when SAMLResponse carries InResponseTo
    // (SP-initiated flows); skip silently when absent (IdP-initiated flows).
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
// Requires a single-field Firestore index on idpEntityId — Firestore creates
// this automatically on first query; no manual index definition needed.
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

  // Check the in-process cache to avoid rebuilding the instance.
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
// SP metadata is tenant-agnostic (same entity ID and ACS URL for all tenants),
// so a single env-var-backed instance is sufficient for that endpoint.
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
function resetSaml()  { resetCache(); } // kept for backward compat

module.exports = { getSamlForDomain, getSamlForIssuer, getSaml, resetSaml, resetCache };

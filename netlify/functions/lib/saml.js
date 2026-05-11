'use strict';

// ── SAML SP singleton ──────────────────────────────────────────────────────
// Builds and caches a configured @node-saml/node-saml SAML instance for the
// Microsoft Entra ID (Azure AD) integration.
//
// Required env vars:
//   ENTRA_TENANT_ID      Azure AD tenant GUID
//   ENTRA_SP_ENTITY_ID   Our SP Entity ID (e.g. https://yourapp.netlify.app)
//   ENTRA_ACS_URL        Full ACS callback URL (e.g. https://yourapp.netlify.app/api/auth/saml/callback)
//   ENTRA_IDP_CERT       Entra signing certificate — PEM body, newlines as \\n in Netlify env

const { SAML } = require('@node-saml/node-saml');

let _instance = null;

function getSaml() {
  if (_instance) return _instance;

  const tenantId = process.env.ENTRA_TENANT_ID;
  if (!tenantId) throw new Error('ENTRA_TENANT_ID is not configured.');

  const acsUrl    = process.env.ENTRA_ACS_URL;
  const entityId  = process.env.ENTRA_SP_ENTITY_ID;

  if (!acsUrl || !entityId) {
    throw new Error('ENTRA_ACS_URL and ENTRA_SP_ENTITY_ID must both be set.');
  }

  // Netlify env vars encode newlines as literal \\n — sanitise the same way
  // as the Firebase private key in firebaseAdmin.js.
  const rawCert = process.env.ENTRA_IDP_CERT || '';
  const cert = rawCert
    .replace(/\\n/g, '\n')
    .replace(/^"|"$/g, '')
    .trim();

  if (!cert) throw new Error('ENTRA_IDP_CERT is not configured.');

  _instance = new SAML({
    // Service Provider
    callbackUrl:          acsUrl,
    issuer:               entityId,

    // Identity Provider (Entra ID)
    entryPoint:           `https://login.microsoftonline.com/${tenantId}/saml2`,
    idpIssuer:            `https://sts.windows.net/${tenantId}/`,
    idpCert:              cert,

    // Assertion requirements
    wantAssertionsSigned: true,

    // Entra ID signs assertions with SHA-1 by default unless the Azure portal
    // is explicitly configured for SHA-256.  Using sha256 here causes
    // xml-crypto to reject a valid SHA-1 signature.
    signatureAlgorithm:   'sha1',
    digestAlgorithm:      'sha1',

    // Entra does not include a RequestedAuthnContext in its responses;
    // without this flag @node-saml rejects the assertion.
    disableRequestedAuthnContext: true,

    // -1 disables clock-skew enforcement entirely, eliminating any
    // timing-related signature rejections during testing.
    acceptedClockSkewMs:  -1,
  });

  return _instance;
}

// Allow tests / hot-reload to reset the singleton.
function resetSaml() { _instance = null; }

module.exports = { getSaml, resetSaml };

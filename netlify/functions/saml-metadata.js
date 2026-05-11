'use strict';

// ── SP Metadata Endpoint ───────────────────────────────────────────────────
// GET /api/auth/saml/metadata
//
// Returns our Service Provider XML metadata so it can be uploaded directly
// to the Azure AD portal (Enterprise Applications → SAML → Upload Metadata).
// This auto-configures the Entity ID, ACS URL, and signing requirements.

const { getSaml } = require('./lib/saml');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'text/plain' },
      body: 'Method not allowed.',
    };
  }

  let saml;
  try {
    saml = getSaml();
  } catch (err) {
    console.error('[saml-metadata] Config error:', err.message);
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'SAML SSO is not configured on this server.',
        detail: err.message,
      }),
    };
  }

  try {
    // generateServiceProviderMetadata(decryptionCert, signingCert)
    // Passing null for both since we are not encrypting assertions or signing
    // AuthnRequests in this initial configuration.
    const xml = saml.generateServiceProviderMetadata(null, null);

    return {
      statusCode: 200,
      headers: {
        'Content-Type':        'application/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sp-metadata.xml"',
        'Cache-Control':       'public, max-age=3600',
      },
      body: xml,
    };
  } catch (err) {
    console.error('[saml-metadata] Error generating metadata:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to generate SP metadata.' }),
    };
  }
};

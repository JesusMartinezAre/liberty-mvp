'use strict';

// ── SAML Initiation ────────────────────────────────────────────────────────
// GET /api/auth/saml/initiate?email=user@libertycoke.com
//
// Generates a signed SAMLRequest and returns the IdP redirect URL.
// The frontend navigates the browser to that URL to begin the SAML flow.

const { getSaml } = require('./lib/saml');
const { appJson } = require('./lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return appJson(405, { error: 'Method not allowed.' });
  }

  let saml;
  try {
    saml = getSaml();
  } catch (err) {
    console.error('[saml-initiate] Config error:', err.message);
    return appJson(503, {
      error: 'SAML SSO is not configured on this server.',
      detail: err.message,
    });
  }

  try {
    const email = (event.queryStringParameters?.email || '').trim().toLowerCase();

    // getAuthorizeUrlAsync(RelayState, host, options)
    // Pass login_hint as an additionalParam so Entra pre-fills the email field.
    const redirectUrl = await saml.getAuthorizeUrlAsync('', '', {
      additionalParams: email ? { login_hint: email } : {},
    });

    return appJson(200, { redirectUrl });
  } catch (err) {
    console.error('[saml-initiate] Error building AuthnRequest:', err.message);
    return appJson(500, { error: 'Could not generate SAML request.' });
  }
};

'use strict';

// ── SAML Initiation — Multi-Tenant ────────────────────────────────────────
// GET /api/auth/saml/initiate?email=user@domain.com
//     /api/auth/saml/initiate?domain=domain.com
//
// Either ?email= or ?domain= is required to identify the tenant.
// The handler looks up the IdP configuration in sso_configs/{domain},
// builds a signed SAMLRequest, and returns the IdP redirect URL.
// The frontend navigates the browser to that URL to begin the SAML flow.
//
// The tenant domain is passed as RelayState so the ACS endpoint has a
// secondary correlation hint. However, the ACS always uses the SAMLResponse
// <Issuer> as the authoritative tenant identifier — RelayState is advisory only.

const { getSamlForDomain } = require('./lib/saml');
const { appJson }          = require('./lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return appJson(405, { error: 'Method not allowed.' });
  }

  const params = event.queryStringParameters || {};
  const email  = (params.email  || '').trim().toLowerCase();
  const domain = (params.domain || '').trim().toLowerCase();

  // Accept either form: ?domain=libertycoke.com or ?email=user@libertycoke.com
  const tenantDomain = domain || (email.includes('@') ? email.split('@')[1] : '');

  if (!tenantDomain) {
    return appJson(400, {
      error: 'Missing required parameter: provide ?email= or ?domain= to identify the SSO tenant.',
    });
  }

  let tenant;
  try {
    tenant = await getSamlForDomain(tenantDomain);
  } catch (err) {
    console.error('[saml-initiate] Config error for domain:', tenantDomain, err.message);
    return appJson(503, { error: 'SAML SSO is misconfigured for this domain.' });
  }

  if (!tenant) {
    return appJson(404, {
      error: `No SSO configuration found for domain: ${tenantDomain}`,
    });
  }

  try {
    // getAuthorizeUrlAsync(RelayState, host, options)
    // RelayState = tenantDomain: echoed back by the IdP, used as a secondary
    // correlation hint in the ACS. Not trusted for security decisions.
    // login_hint  — pre-fills the email field in Entra's UI.
    // domain_hint — signals Home Realm Discovery to skip the account-picker screen.
    const redirectUrl = await tenant.saml.getAuthorizeUrlAsync(tenantDomain, '', {
      additionalParams: email
        ? { login_hint: email, domain_hint: tenantDomain }
        : {},
    });

    console.log('[saml-initiate] AuthnRequest generated for domain:', tenantDomain);
    return appJson(200, { redirectUrl });

  } catch (err) {
    console.error('[saml-initiate] Error building AuthnRequest for domain:', tenantDomain, err.message);
    return appJson(500, { error: 'Could not generate SAML request.' });
  }
};

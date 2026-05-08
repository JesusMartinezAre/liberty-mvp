// ── Okta OIDC configuration ────────────────────────────────────────────────
// Fill in your real values from the Okta Admin Console:
//   Applications → Your SPA app → General → Client Credentials
window.OKTA_CONFIG = {
  issuer:      'https://trial-4853341.okta.com/oauth2/default',
  clientId:    '0oa12ryhdspmiC7Wf698',
  redirectUri: window.location.origin + '/auth/callback.html',
  scopes:      ['openid', 'profile', 'email'],
};

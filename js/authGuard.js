// ── Okta session guard ─────────────────────────────────────────────────────
// Call requireOktaSession() on every protected page.
// Returns the user object on success, redirects to login on failure.
async function requireOktaSession() {
  const oktaAuth   = new OktaAuth(window.OKTA_CONFIG);
  const accessToken = await oktaAuth.tokenManager.get('accessToken');

  if (!accessToken) {
    window.location.href = '/auth/login.html';
    return null;
  }

  const response = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${accessToken.accessToken}` },
  });

  if (!response.ok) {
    await oktaAuth.signOut({
      postLogoutRedirectUri: window.location.origin + '/auth/login.html',
    });
    return null;
  }

  return response.json();
}

/**
 * OAuth.gs — OAuth Flow Handlers
 *
 * Handles authentication between the Apps Script add-on and the
 * Cloud Functions backend. Uses the built-in ScriptApp.getOAuthToken()
 * for Google identity, which the backend verifies.
 *
 * Flow:
 *   1. Sidebar opens → Apps Script gets Google OAuth token
 *   2. Token sent with every /analyze request as Bearer header
 *   3. Cloud Function verifies token with Google's tokeninfo endpoint
 *   4. On first verify, Cloud Function creates user in Supabase
 */

/**
 * Get the current user's OAuth token for backend calls.
 * This token is a Google access token scoped to the user's identity.
 *
 * @return {string} OAuth access token.
 */
function getAuthToken() {
  return ScriptApp.getOAuthToken();
}

/**
 * Get the current user's email address.
 *
 * @return {string} Email address.
 */
function getUserEmail() {
  return Session.getActiveUser().getEmail();
}

/**
 * Check if the user has authorized all required scopes.
 * Called from sidebar on load.
 *
 * @return {Object} Auth status with user info.
 */
function checkAuthStatus() {
  try {
    var email = Session.getActiveUser().getEmail();
    var token = ScriptApp.getOAuthToken();

    return {
      authorized: true,
      email: email,
      hasToken: !!token
    };
  } catch (e) {
    return {
      authorized: false,
      error: e.message
    };
  }
}

/**
 * Register the user with the backend (called once on first use).
 *
 * @return {Object} Registration result.
 */
function registerUser() {
  var token = ScriptApp.getOAuthToken();
  var email = Session.getActiveUser().getEmail();

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ email: email }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(CLOUD_FUNCTION_BASE + '/auth', options);
  return JSON.parse(response.getContentText());
}

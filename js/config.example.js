// Template. Copy to js/config.js and fill in — js/config.js is gitignored so
// your credentials never reach the public repo.
//
// EE_CLIENT_ID must be an OAuth 2.0 *Web application client ID*, which looks
// like "1234567890-abc123.apps.googleusercontent.com". It is NOT an API key
// (the "AIzaSy..." kind) — Earth Engine's browser auth uses OAuth, and an API
// key will fail to sign in. Create one in Google Cloud Console →
// APIs & Services → Credentials → Create credentials → OAuth client ID →
// Web application, and add http://localhost:3000 as an authorized JavaScript
// origin. OAuth client IDs are public by design, but this file stays local so
// nothing else here can leak by accident.
//
// EE_PROJECT is the Google Cloud project ID with the Earth Engine API enabled.
//
// Leave both blank to run on satellite base imagery without the Earth Engine
// band layers — everything else in the app still works.
window.FIELDLOOP_CONFIG = {
  EE_CLIENT_ID: "",
  EE_PROJECT: ""
};

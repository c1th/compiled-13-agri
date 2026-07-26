// FieldLoop client config. Earth Engine needs a Google Cloud project with
// the Earth Engine API enabled and an OAuth 2.0 Web client ID (add your
// http://localhost:3000 origin to it). Client IDs are public — safe here.
// Leave blank to run on the satellite base map without the NDVI overlay.
window.FIELDLOOP_CONFIG = {
  EE_CLIENT_ID: "",   // e.g. "1234567890-abc.apps.googleusercontent.com"
  EE_PROJECT: ""      // e.g. "my-earthengine-project"
};

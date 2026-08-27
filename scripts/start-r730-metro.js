/**
 * Launch Metro for the R730 dev service — tunnel when a token exists, IP when
 * not.
 *
 * Field report (2026-08-28): the iOS dev build would not load bundles from a
 * bare IP URL; the workflow that always worked was Expo's tunnel
 * (https://<slug>-<account>-8081.exp.direct). So the service prefers
 * `--tunnel`, which needs an Expo access token because a service has no
 * browser to log in with.
 *
 * The token is the OWNER'S credential and never enters the repo or a chat:
 * the service points EXPO_TOKEN_FILE at a file on the R730
 * (C:\turtle-dev\home\expo-token.txt) that the owner writes there by hand.
 * File absent or empty → honest fallback to the plain-IP mode, loudly
 * labeled, so a missing token degrades to "works on the tailnet" rather than
 * a dead service.
 */
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = process.env.RCT_METRO_PORT || '8181';
const HOST_IP = process.env.TURTLE_METRO_HOST || '100.85.19.127';

let token = '';
const tokenFile = process.env.EXPO_TOKEN_FILE || '';
if (tokenFile) {
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { /* absent = IP mode */ }
}

const args = ['expo', 'start', '--dev-client', '--port', PORT];
const env = { ...process.env, RCT_METRO_PORT: PORT };

if (token) {
  env.EXPO_TOKEN = token;
  args.push('--tunnel');
  console.log(`[start-r730] tunnel mode (token from ${tokenFile}); the exp.direct URL prints below`);
} else {
  env.REACT_NATIVE_PACKAGER_HOSTNAME = HOST_IP;
  console.log(`[start-r730] NO token file at ${tokenFile || '(EXPO_TOKEN_FILE unset)'} — plain-IP mode on http://${HOST_IP}:${PORT}`);
  console.log('[start-r730] if the phone cannot load from an IP, put an Expo access token in that file and restart this service');
}

const child = spawn('npx', args, { env, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 1));

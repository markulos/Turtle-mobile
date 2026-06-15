# iOS Share Extension — Build & Install Guide

The mobile app now registers as a destination in the iOS / Android
Share sheet. Sharing a photo, link, or text from any app gives the user
a "Turtle" target that opens our `ShareTargetScreen` where they pick a
pinned board to send the content to.

This guide walks through producing a buildable iOS app from **Windows**
(no Mac required) using EAS Build's cloud Mac, and installing it on
your iPhone for testing.

---

## Prerequisites

1. **Apple ID** — free tier is fine for personal development builds.
   You don't need a paid Developer Program membership for ad-hoc
   internal distribution to your own devices via EAS.
2. **Expo account** — free. Sign up at https://expo.dev/signup.
3. **An iPhone** for testing (the only place where the share extension
   actually shows up in Safari/Photos/etc).
4. **EAS CLI** installed locally:
   ```bash
   npm install -g eas-cli
   eas login
   ```

---

## One-time setup

### 1. Pick a real bundle identifier

The current `app.json` has the placeholder
`com.yourcompany.passwordtaskmanager`. Change it to something you own —
e.g. `com.markboulos.turtle` — BEFORE the first EAS build, because
Apple ties the share-extension entitlements to the bundle ID.

Edit `mobile-app/app.json`:

```json
"ios": {
  "bundleIdentifier": "com.markboulos.turtle",
  ...
}
```

Also update the Android `package` to match the pattern.

### 2. Initialize EAS in the mobile-app

```bash
cd "D:/hobby PROJECTS/TURTLE APP/mobile-app"
eas init
```

This creates `eas.json` with default `development`, `preview`, and
`production` profiles. The `development` profile is the one you'll
use day-to-day — it includes the Expo Dev Client (JS hot reload)
while still containing the native Share Extension code.

### 3. Configure credentials (interactive)

```bash
eas credentials
```

Pick **iOS → Set up build credentials**. EAS will guide you through
generating a development certificate + provisioning profile tied to
your Apple ID. The first time it asks "do you want EAS to manage
credentials?", say **yes** — they handle the dance with Apple for you.

When it asks for a **device UDID**, run this on your iPhone:

- Open Safari and go to https://expo.dev/register-device
- Sign in to Expo, follow the prompts to install a small
  configuration profile that registers your iPhone's UDID with your
  Expo account.
- The UDID then shows up automatically when EAS asks.

You only do this once per device.

---

## Building

```bash
cd "D:/hobby PROJECTS/TURTLE APP/mobile-app"
eas build --profile development --platform ios
```

What happens:

1. EAS uploads your source to its cloud.
2. A Mac runner runs `expo prebuild` (generating `ios/` with the share
   extension target injected by the `expo-share-intent` config plugin).
3. Xcode compiles. This is the slow step — ~10–15 minutes for the
   first build, 5–8 minutes for incremental builds.
4. EAS signs the `.ipa` with your dev cert + provisioning profile.
5. You get a URL + QR code for installing on your iPhone.

On your iPhone, scan the QR code or open the URL — Safari prompts to
install the dev build. After install, the app appears on your home
screen with the normal Turtle icon. Open it once to register it with
the OS so the share extension activates.

---

## Verifying the share extension works

1. Open **Photos** on your iPhone, pick a photo, tap **Share**.
2. Swipe horizontally through the share-target row at the top — you
   should see **Turtle** (or whatever app name you configured). If
   not, scroll all the way right and tap **More...** to enable it.
3. Tap **Turtle** — the app launches and you should see the
   `ShareTargetScreen` with the photo previewed and your pinned
   boards listed.
4. Tap a board. The screen shows a brief checkmark, then returns you
   to Photos.
5. Open the Turtle **web app** in your browser. The chat preview pane
   should now show the photo. The photo is also visible in the
   album/project/tag you sent it to.

Repeat with Safari → a webpage → Share → Turtle to test the URL path.

---

## Iteration loop (hot reload)

Once the dev build is installed on your phone:

```bash
cd "D:/hobby PROJECTS/TURTLE APP/mobile-app"
npm start
```

The QR code in the terminal goes to the **Dev Client**, not Expo Go.
Scan it from the installed Turtle app's launch screen and JS hot
reload kicks in. You can edit `ShareTargetScreen.jsx` and the changes
appear in the share screen on the next share without rebuilding.

You only need to rebuild via EAS when you change:
- The `expo-share-intent` plugin config in `app.json`
- The `iosActivationRules` (which file types the extension accepts)
- The bundle identifier or app name
- Any other native config

---

## Updating accepted share types

The current activation rules in `app.json` accept:
- Text (any text selection)
- One web URL
- One web page
- Up to 10 images
- Up to 5 files

To accept e.g. video or PDF:

```json
"iosActivationRules": {
  ...existing,
  "NSExtensionActivationSupportsMovieWithMaxCount": 3,
  "NSExtensionActivationSupportsFileWithMaxCount": 10
}
```

After editing, re-run `eas build --profile development --platform ios`.
The server-side `/api/share` endpoint currently only handles `text`,
`url`, and `images`; widening server support is a separate change.

---

## Troubleshooting

**"Turtle" doesn't appear in the share sheet**
- Did you install the dev build (not Expo Go)? Expo Go's sandbox
  doesn't support share extensions.
- Open the app once after install so iOS registers it.
- Scroll all the way right in the share-target row and tap **More**.
  Drag Turtle up to favorite it.

**Share extension launches but boards list is empty**
- ServerContext doesn't have your `serverIP` yet. Open the main
  Turtle app and complete the login/connect flow first.
- Verify boards are pinned: in the web app → Settings → Share boards.
- Verify the server is reachable from the phone's network.

**"Could not load destinations" after sharing**
- The phone can reach the server only over the same LAN it's on. If
  you're sharing from cellular data, configure a reverse proxy or
  Tailscale path to your server.

**EAS build fails on the Mac runner**
- Check the build logs in https://expo.dev/accounts/.../builds.
- Most common cause is a peer-dep mismatch when a package gets
  upgraded out of step with Expo SDK. Run
  `npx expo install --check` locally and re-build.

---

## Cost reality check

- EAS Build free tier: **30 iOS builds/month**. You'll easily fit
  inside this for personal dev.
- Each build takes 10–15 min of cloud Mac time. If you exceed the
  free tier, you can buy individual builds for a couple dollars.
- The dev certificate from a free Apple ID expires every **7 days**.
  This means apps installed via the development profile stop working
  after a week and need re-signing/re-install. To extend this to one
  year, enroll in the Apple Developer Program ($99/yr).

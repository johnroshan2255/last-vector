# Mobile builds (Capacitor · Android + iOS)

The native apps are the Vite build (`client/dist`) wrapped in a Capacitor WebView.
Everything web-side keeps working unchanged; the native projects live in
`client/android/` and `client/ios/` and are committed. No desktop / Electron target.

| piece                                                            | where                                      |
| ---------------------------------------------------------------- | ------------------------------------------ |
| Capacitor config (`appId in.synctric.lastvector`, `webDir dist`) | `client/capacitor.config.ts`               |
| Android project                                                  | `client/android/`                          |
| iOS project (Swift Package Manager, no CocoaPods)                | `client/ios/App/`                          |
| icon / splash sources (1024² + 2732²)                            | `client/assets/` → `npm run mobile:assets` |
| server address resolution + LAN preference                       | `client/src/platform/server.ts`            |
| native shell (status bar, back button, splash)                   | `client/src/platform/native.ts`            |
| Settings → SERVER tab                                            | `client/src/ui/ServerSettings.tsx`         |

## Prerequisites

|                                                                 | needed for                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node ≥ 22** (`nvm use` reads `.nvmrc` → 24)                   | the Capacitor 8 CLI (`cap sync/open/run`). The rest of the repo still runs on Node 20.                                                                                                                                                                                                                                   |
| **JDK 21** + **Android Studio** (Ladybug or newer) with SDK 36  | building the APK. Android Studio bundles a JDK: set `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`. The SDK already at `~/Library/Android/sdk` is picked up by `cap open android`; for plain Gradle create `client/android/local.properties` with `sdk.dir=/Users/<you>/Library/Android/sdk`. |
| **macOS + Xcode 16+** (full Xcode, not just Command Line Tools) | building / running the iOS app. `xcode-select -s /Applications/Xcode.app` after installing. CocoaPods is **not** needed (SPM).                                                                                                                                                                                           |
| **Apple Developer account** ($99/yr)                            | running on a real iPhone with a signing team, TestFlight and App Store submission. A free Apple ID can sideload to your own device for 7 days.                                                                                                                                                                           |

Neither the JDK, Android Studio nor Xcode were installed on this machine when the branch was created, so
the native projects are generated and configured but no APK / IPA has been produced yet.

## Full command sequence

```bash
nvm use                          # Node 24 for the Capacitor CLI

# 1. build the web app and copy it into both native projects
npm run mobile:sync              # = npm run build -w client && cap sync (android + ios)

# 2a. Android — open in Android Studio (Gradle sync, run on device/emulator, Build ▸ APK)
npm run mobile:android           # = cap open android

# 2b. Android — debug APK from the terminal
npm run android:debug -w client  # = cd client/android && ./gradlew assembleDebug
#    → client/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r client/android/app/build/outputs/apk/debug/app-debug.apk

# 2c. Android — release-signed APK / Play bundle (see "Release signing" first)
npm run android:release -w client   # → app/build/outputs/apk/release/app-release.apk
npm run android:bundle -w client    # → app/build/outputs/bundle/release/app-release.aab

# 3a. iOS — open in Xcode: pick your Team under Signing & Capabilities, choose a device, ⌘R
npm run mobile:ios               # = cap open ios

# 3b. iOS — run on a connected device / simulator straight from the CLI
npx --prefix client cap run ios  # prompts for a target
```

Shortcuts: `npm run mobile:apk` (sync + debug APK) and `npm run mobile:apk:release`.

Every time the web code changes: `npm run mobile:sync`, then rebuild in Studio / Xcode.
Live-reload during development: `npm run dev:client` then start the app with
`npx --prefix client cap run android -l --external` (or `ios`) so the WebView loads the Vite dev server.

### Release signing (Android)

```bash
keytool -genkeypair -v -keystore client/android/last-vector.jks -alias lastvector \
        -keyalg RSA -keysize 2048 -validity 10000
cp client/android/keystore.properties.example client/android/keystore.properties   # fill in passwords
npm run mobile:apk:release
```

`app/build.gradle` picks up `keystore.properties` when present and signs the `release` build type.
The keystore and the properties file are git-ignored — back them up; Play uploads must use the same key forever.
Bump `versionCode` / `versionName` in `client/android/app/build.gradle` for each store upload.

### iOS: signing and submission

1. Xcode ▸ target **App** ▸ Signing & Capabilities ▸ tick _Automatically manage signing_, pick your Team.
   The bundle id is `in.synctric.lastvector` (change in the same panel and in `capacitor.config.ts`).
2. First run on a device: trust the developer profile on the phone (Settings ▸ General ▸ VPN & Device Management).
3. Store: Product ▸ Archive ▸ Distribute App ▸ App Store Connect. Create the app record in App Store Connect
   first, with the same bundle id. Bump the version/build in the General tab for each upload.
4. The app is landscape-only and `UIRequiresFullScreen` is set, which is what App Store review expects for
   a landscape game on iPad.

## Networking

- **Server address** (`client/src/platform/server.ts`), highest priority first:
  `?server=` query (web only) → address saved in Settings ▸ SERVER → `VITE_SERVER_URL` at build time →
  `PRODUCTION_SERVER_URL` in the native app / the page's own host on :2567 on the web.
  **Set `PRODUCTION_SERVER_URL` (or build with `VITE_SERVER_URL=wss://…`) before shipping a store build** —
  the placeholder `wss://play.last-vector.example.com` is not a real server.
- **Settings ▸ SERVER** saves host / port / TLS with `@capacitor/preferences` (native storage in the app,
  localStorage on the web). _SAVE & CONNECT_ opens a real WebSocket to the address plus `GET /health`, and
  shows CONNECTING / CONNECTED / FAILED; while the game itself is connecting or in a room, that live state
  is shown instead.
- **Android cleartext (`ws://`) is scoped, not blanket**: `android/app/src/main/res/xml/network_security_config.xml`
  keeps TLS-only as the base rule and opens cleartext for `localhost`, `10.0.2.2` (emulator → host machine),
  `*.local` mDNS names, and an explicit list of LAN IPs. Android matches by host name and cannot express
  IP ranges, so **add the LAN IP(s) you host on to that file** (or reach the Mac as `your-mac.local`).
  The WebView serves the bundle from `http://localhost` (`androidScheme: 'http'`) so a `ws://` socket is not
  mixed content; `wss://` works from anywhere.
- **iOS**: `Info.plist` has `NSAppTransportSecurity › NSAllowsLocalNetworking` (ATS exception for local
  addresses only) and `NSLocalNetworkUsageDescription` (the iOS 14+ local-network prompt the first time
  the app touches a LAN address). Public servers must be `wss://`.
- The server already answers `GET /health` and has CORS enabled; nothing server-side changed.

## Touch input

The virtual sticks + buttons (`client/src/ui/MobileControls.tsx`) are mounted only when
`useResponsiveCanvas` reports a touch device: always in the native app, and on the web when the primary
pointer is coarse or the device has touch points and no hover. A touchscreen laptop driven by mouse and
keyboard therefore keeps the desktop controls, and `InputSystem` still ignores touch pointers on the canvas
so mouse aim and keyboard keep working in a browser.

## Native shell behaviour

- Status bar hidden + overlaid; re-hidden on resume (`@capacitor/status-bar`).
- Splash: dark `#05060a` with the icon; hidden as soon as the web view is up.
- Android back button: closes settings → pauses → resumes → leaves lobby/game-over; on the menu it
  backgrounds the app instead of quitting.
- Orientation locked to landscape natively (manifest `sensorLandscape`, plist landscape only), so the web
  fullscreen / orientation-lock helpers are no-ops in the app.

## Regenerating icons / splash

Replace `client/assets/icon.png` (1024²), `icon-foreground.png`, `icon-background.png` and
`splash.png` / `splash-dark.png` (2732²), then `npm run mobile:assets`. The current set is the 512 px web
icon upscaled with nearest-neighbour on the game's background colour — fine for testing, worth replacing
with proper art before a store listing.

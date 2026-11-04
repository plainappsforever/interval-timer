# Plain Intervals

Interval timer for HIIT, Tabata and circuits; voice cues with the screen off.

Plain Intervals times any interval workout: HIIT, Tabata, EMOM, circuits, boxing rounds, walk/run, stretching or your own. A voice calls every interval and the beeps keep coming with the screen off, while your music keeps playing. Free, with no ads, no account, no workout limit and no subscription.

**Get it:** [App Store](https://plainapps.dfdsfdsfsdf.workers.dev/apps/interval-timer/) · [Google Play](https://plainapps.dfdsfdsfsdf.workers.dev/apps/interval-timer/) · [GitHub Releases](https://github.com/plainappsforever/interval-timer/releases) ·
[Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/plainappsforever/interval-timer)

**Status:** first store release pending.

## Our promise

**Free, no ads, no tracking, no accounts.** This app keeps your data on your phone. It has no analytics, no crash
reporter, no advertising SDK and no sign-in. The Android release build has no INTERNET permission at all. We will not sell this app or this project to a company
that changes any of this.

Why we write it down: in 2023 a popular open-source Android suite was sold to an ad-funded app company and its store
listings started saying "Contains ads"; its community had to fork it to keep a clean version. The source code of
Plain Intervals is published under GPL-3.0, so if this promise were ever broken, anyone could continue the last
version that kept it.

## What it does

START IN TWO TAPS
• The big Start button runs the timer you used last. No onboarding, no sign-up, no permission request.
• Seven templates to begin with: Tabata, HIIT 30/15, EMOM 10, Boxing 3/1, Walk/Run, Circuit, Stretch.

BUILD ANY TIMER
• Blocks of intervals with rounds and rest between rounds; name every interval ("Squats", "Plank").
• Work, rest, prep and cool-down types, a colour per interval, halfway cue, countdown from 3, 5 or 10.
• Open intervals that wait for your "Next" tap, with an optional reminder beep.
• Save as many timers as you like; search, duplicate, share.

CUES YOU CAN HEAR
• Spoken interval names and countdowns in the voice installed on your phone, plus three beep sets.
• Sound, voice and vibration continue when the screen is locked; a notification has Pause, Skip and End, and the headset button pauses.
• Music and podcasts keep playing: the cues mix in instead of stopping them.
• A call pauses the workout; it stays paused until you resume.

THE RUNNING SCREEN
• Full-screen colour of the current interval, big numbers you can read from across the room, landscape too.
• Pause, Back, Skip, +30 s, End; a lock against stray taps; the screen stays on.
• If the phone closes the app mid-workout, the next start offers to resume where you were.

HISTORY
• Every workout saved with planned and actual time, skipped intervals and pauses; "ended early" when you stop.
• Totals for the day, week and month, streak, most used timer; export as CSV.

YOUR DATA STAYS ON YOUR PHONE
Plain Intervals has no internet permission. Timers, history and settings are stored on this phone. A backup file and timer links leave it only when you share them yourself. 15 languages.

## Privacy

- All data is stored locally (SQLite in the app's private storage). Nothing is uploaded.
- Files leave the phone only when you share or export them yourself.
- Privacy policy: https://plainapps.dfdsfdsfsdf.workers.dev/apps/interval-timer/privacy

## Build from source

You need: **Node.js 22 LTS** (the React Native version used here accepts `^20.19.4 || ^22.13.0 || ^24.3.0`), npm,
and git. The app is an [Expo](https://expo.dev) (SDK 57) / React Native app; the native `android/` and `ios/` folders
are generated from `app.config.ts` and are not in the repository.

```sh
git clone https://github.com/plainappsforever/interval-timer.git
cd interval-timer
npm ci
npm run verify          # typecheck + lint + all unit tests
```

### Android (Linux, macOS or Windows)

Needs JDK 17 and the Android SDK (Android Studio installs both; set `ANDROID_HOME`).

```sh
export APP_VARIANT=production
npx expo prebuild --platform android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: android/app/build/outputs/apk/release/ (signed with the debug key unless you configure your own key)
```

`APP_VARIANT` selects the app id and name (`development`, `preview`, `production`; see `app.config.ts`).
Builds made this way are signed with your key, not ours, so they cannot update an installed store version.

### iOS (macOS only)

Needs Xcode (26 or newer) and CocoaPods.

```sh
export APP_VARIANT=production
npx expo prebuild --platform ios
npx expo run:ios --configuration Release        # runs on the iOS Simulator
```

For a real iPhone, open `ios/*.xcworkspace` in Xcode, choose your own team under *Signing & Capabilities*
and change the bundle identifier. There is no sideloading store for iOS; the App Store build is ours.

## Verifying a release

Every GitHub release lists SHA-256 checksums (`SHA256SUMS.txt`) and the APKs are signed with one key per app.
Certificate SHA-256 fingerprint: `not yet published on Android`

## How this app was made

Plain Intervals was written with substantial help from an AI coding assistant (Claude Code), directed, reviewed and
tested by the maintainer. We say this openly because some stores and users care about it.

## Licence

Copyright (C) 2026 Farija Retkoceri

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, version 3 (GPL-3.0-only). See [LICENSE](LICENSE).
Third-party components keep their own licences (see `LICENSES/` and the app's licences screen where present).
Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

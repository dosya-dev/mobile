# dosya for iPhone and Android

The [dosya.dev](https://dosya.dev) app for phones and tablets. It backs up your
photos, videos and contacts automatically, and it gives you all your dosya
files on the go: browse, preview, share, play and work offline.

[App Store](https://apps.apple.com/app/id6796702157) ·
[Google Play](https://play.google.com/store/apps/details?id=dev.dosya) ·
[dosya.dev/mobile](https://dosya.dev/mobile/)

We publish this code so you can read and audit what runs on your phone. It is
source available, not open source: see [License](#license).

## What's inside

- **Backup:** photos, videos and contacts upload in the background, with
  folder choice, Wi-Fi and battery rules, free-up-space and failed-item retry.
- **Files:** browse every workspace, upload, move, rename, star, comment,
  request files and share links.
- **Viewers:** images, video (VLC-based player with Chromecast and AirPlay),
  music with CarPlay and Android Auto, PDFs and ebooks, documents and a
  photo map.
- **Offline:** keep files on the device and open them without a connection.
- **Vault:** end-to-end encrypted files, decrypted only on your device.
- **Smart Search and Personas:** search photos by what's in them, and group
  faces on the device. Face data never leaves your phone unencrypted.
- **Platform extras:** Files app and Storage Access provider, share sheet,
  home-screen backup widget, document scanner, Siri and app PIN lock with
  Face ID.
- **40 languages,** including Arabic, Hebrew and Persian with a right-to-left
  layout.

## Built with

- [Expo](https://expo.dev) SDK 54, React Native 0.81, React 19
- [expo-router](https://docs.expo.dev/router/introduction/) for navigation
- [NativeWind](https://www.nativewind.dev) for styling
- Our own native modules in [`modules/`](modules) (Swift and Kotlin) for
  background upload, the backup service, the Files provider, the VLC player,
  the document scanner and more

## Requirements

- Node 22
- For iOS: macOS, Xcode and CocoaPods
- For Android: Android Studio with an emulator or a device

The app uses its own native code, so it does not run in Expo Go. You need a
development build.

## Get started

```bash
npm install          # also applies the fixes in patches/
npm run ios          # build and run on the iOS simulator
npm run android      # build and run on an Android emulator or device
```

The native `ios/` and `android/` folders are generated on the first run and
are not committed. Once a development build is installed, `npm start` serves
the JavaScript with fast refresh.

The app talks to `https://api.dosya.dev`. Sign in with your dosya account.

### Optional settings

| Variable | What it does |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Point the app at another dosya API |
| `EXPO_PUBLIC_WEB_ORIGIN` | Origin used for links into the web app |
| `GOOGLE_SERVICES_JSON` | Path to your own Firebase file (Android push). Without it, push notifications are off |
| `RC_IOS_KEY`, `RC_ANDROID_KEY` | RevenueCat keys for in-app purchases. Without them, the store paywall is off |

## Check your changes

```bash
npm run typecheck
npm run lint
npm test
```

## Project layout

| Path | What's there |
| --- | --- |
| [`app/`](app) | Screens and routes (expo-router) |
| [`src/`](src) | Features, one folder each: `backup`, `files`, `vault`, `personas`, `player`, `offline` and more |
| [`src/api/`](src/api) | Typed client for the dosya API |
| [`modules/`](modules) | Native modules written for this app |
| [`targets/`](targets) | iOS extensions: home-screen widget and Files provider |
| [`plugins/`](plugins) | Expo config plugins (CarPlay, Siri, backup rules) |
| [`vendor/`](vendor) | Bundled copies of our shared encryption, Personas and ebook code |
| [`patches/`](patches) | Fixes applied to third-party packages on install |

A few scripts (`gen:brand`, `vendor:e2ee`, `vendor:i18n` and the theme
generator) refresh files from our main repository. They don't work in this
repo, and you don't need them: their output is already committed.

## Contributing

Bug reports and pull requests are welcome. For security issues, please email
security@dosya.dev instead of opening a public issue.

By sending a contribution, you agree it can be used under the license below.

## License

Source available under the [Dosya Source Available License 1.0](LICENSE).

- **You can** read and audit the code, build and run it with the official
  [dosya.dev](https://dosya.dev) service, and contribute improvements.
- **You can't** redistribute it, use it with any backend other than dosya.dev,
  or offer it as a service.

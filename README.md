# @dosya-dev/mobile

React Native + Expo client for dosya.dev - automatic photo/video + contacts backup and a full file companion.

## Develop
```bash
cd apps/mobile
npm install
npm start          # Expo dev server (Expo Go for Phase 0/1)
npm run typecheck
npm test
```

Native background modules (Phase 4) require a dev client: `eas build --profile development`.

## Structure
- `app/` - expo-router routes (tabs: Files / Backup / Settings)
- `src/api/` - typed API client (base URL `https://api.dosya.dev`)
- `src/theme/` - web theme tokens ported to hex; regenerate with `node scripts/gen-theme.mjs`

## Notes
- `nativewind` is pinned to exact `4.1.23` because 4.2.x requires `react-native-worklets/plugin` (RN 0.83+), which is incompatible with Expo SDK 53 / RN 0.79.6. Do not run `expo install nativewind` or `npm update` blindly - revisit the pin at SDK 54.

## License

Source-available under the [Dosya Source Available License 1.0](LICENSE):

- **You can** read and audit the code, build and run it with the official
  [dosya.dev](https://dosya.dev) service, and contribute improvements.
- **You can't** redistribute it, use it with any backend other than dosya.dev, or offer
  it as a service.

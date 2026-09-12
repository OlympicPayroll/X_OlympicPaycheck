# Olympic Paycheck — mobile app

This folder is the React Native (Expo) app. The full project documentation (what the app does, its architecture, the technologies used, the project history and the open items) is in the [repository README](../README.md).

## Requirements

- Node.js 20 LTS or newer, and npm
- An Android phone or emulator, or an iPhone
- For phone builds: an [Expo](https://expo.dev) account with access to the `olympic-paycheck` project

## Common commands

Run these from this folder.

| Task | Command |
|---|---|
| Install dependencies | `npm install` |
| Start the development server | `npx expo start` |
| Run the tests | `npm test` |
| Type-check | `npm run typecheck` |
| Lint | `npm run lint` |
| Build an installable Android APK | `npx eas-cli build --platform android --profile preview` |

The fingerprint and Face ID prompts, and opening a saved PDF on Android, use native code that Expo Go does not include. Test those on an EAS build.

## Configuration

| Variable | Effect |
|---|---|
| `EXPO_PUBLIC_API_URL` | Base URL of the payroll service. When set, the app uses the HTTP adapter (`src/api/http.ts`). When absent, it runs on the built-in sample data and shows a "SAMPLE DATA" banner. |
| `EXPO_PUBLIC_ALLOW_FIXTURES` | Set to `1` to allow a release build to run on sample data. The `preview` build profile sets it. The `production` profile does not, so a production build without an API URL refuses to start. |

## Where things are

| Path | Contents |
|---|---|
| `src/app/` | Screens. The file names are the routes (Expo Router). |
| `src/api/` | The `PayrollApi` interface, the HTTP adapter, the sample-data backend and the data hooks. |
| `src/lib/` | Sign-in session, biometrics, dialogs, PDF rendering, auto sign-out and other shared logic. |
| `src/components/` | Shared UI: header, cards, buttons, icons, loading and error states. |
| `src/constants/theme.ts` | Design tokens: colours for light and dark mode, spacing and type. |
| `modules/pdf-viewer/` | A small native Android module that opens a saved PDF in the phone's viewer. |
| `__tests__/` | Jest and React Native Testing Library tests. |

## Conventions

- The project is pinned to **Expo SDK 54** (React Native 0.81.5, React 19.1). Add packages with `npx expo install <package>`, so the versions match the SDK. The reference documentation is at <https://docs.expo.dev/versions/v54.0.0/>.
- Screens never talk to a backend directly. They use the hooks in `src/api/queries.ts`, which call whichever `PayrollApi` implementation is active.
- After adding a route, delete `.expo/types/router.d.ts` if the type-check reports unknown routes. The development server regenerates it.
- Babel is configured by Expo automatically. Do not add a `babel.config.js`.

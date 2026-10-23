# MiniLedger

[GitHub repository](https://github.com/adithya4001/miniledger)

A small React Native app for money lent to friends. Record an entry, attach a receipt, see what is overdue, and mark a full repayment. Phone login uses the assignment's mock OTP printed in the backend terminal; no SMS service or paid account is needed.

## Stack

- Node.js, TypeScript, Express 5 and PostgreSQL 16
- React Native 0.86, React 19 and Expo SDK 57 for Android, iOS and web
- Parameterized SQL with `pg`, Zod validation and private image uploads

## Run in about five minutes

Install Node.js 24 LTS and Docker Desktop. From the repository root:

```sh
docker compose up -d
npm run setup
npm run dev:api
```

In a second terminal:

```sh
npm run web
```

Open the browser URL printed by Expo, normally `http://localhost:8081`. Enter a phone number with country code, such as `+919876543210`. Read the six-digit code printed in the API terminal and enter it in the app. This creates an empty private ledger; the app has no preloaded financial records.

`npm run setup` generates a random authentication secret in `apps/api/.env` and creates the mobile app's local API setting. Existing environment files are preserved. PostgreSQL tables and indexes are created idempotently when the backend starts. The Compose database password is a local development value, and its port is bound only to localhost.

If using an existing PostgreSQL server, skip Compose and update `DATABASE_URL` in `apps/api/.env`. Do not commit `.env` files.

## Run on a phone or emulator

```sh
npm run dev:app
```

Use Expo Go with SDK 57 support or a compatible Expo development build. Configure `apps/mobile/.env` before starting Expo:

| Device | `EXPO_PUBLIC_API_URL` |
|---|---|
| Browser / iOS simulator on the backend computer | `http://localhost:4100` |
| Android emulator | `http://10.0.2.2:4100` |
| Physical phone on the same Wi-Fi | `http://YOUR_COMPUTER_LAN_IP:4100` |

Restart Expo after changing the setting. The backend must be reachable from the device. Native requests do not use browser CORS. For a browser preview on a different origin, add its exact origin to `APP_ORIGINS`. A local HTTP API is for development; deployment should use HTTPS and a real OTP provider.

## Checks and builds

```sh
npm run typecheck
npm test
npm run build
npm run export:native --prefix apps/mobile
```

The default ten API tests run with a real embedded PostgreSQL engine (PGlite) and in-process HTTP injection, so they need no running database or open port. They cover OTP hashing, expiration, attempts, replay/concurrent use, session revocation, exact money conversion, overdue totals, user isolation, idempotent repayment, receipt access, upload limits and invalid inputs.

For PostgreSQL 16 / real HTTP integration tests, set `INTEGRATION_DATABASE_URL` to a database where the test role can create schemas, then run `npm test`. Every run creates a unique test schema and removes only that schema afterward; application records are not touched.

`npm run build` compiles the backend to `apps/api/dist` and exports the browser app to `apps/mobile/dist`. `export:native` builds the Android/iOS JavaScript and Hermes bundles into `dist-native`; it does not create an APK or install an app on a device.

## Working demo and CI

The included GitHub Actions workflow runs type checks, embedded tests, PostgreSQL 16 integration tests, browser/native builds, and real browser tests. It records a continuous approximately 2 minute 25 second phone-sized walkthrough of the React Native web app backed by the Node API and PostgreSQL service.

After a successful workflow, download `miniledger-demo-and-checks` from its artifacts. The longer `video.webm` under `test-results` is the working demonstration; `demo-artifacts/chapters.json` lists the sections. Screenshots include login, an empty ledger, overdue entry, receipt, repayment and desktop layout. Upload the demonstration to Loom or Google Drive and enable reviewer access before submitting its link.

To record it yourself locally after running the API and browser export:

```sh
npm ci --prefix qa
cd qa
npx playwright install chromium
```

Run the API from the repository root with its output redirected to `qa/api.log`, then run `node qa/serve.mjs` in a separate terminal. From `qa`, run `npx playwright test`. The demo uses two fictional phone numbers and creates fictional loans in the configured database. Run it against a disposable development database.

## Features and decisions

- A loan is either unpaid or repaid in full; partial repayments, edits and deletion are outside this assignment.
- Amounts are validated as decimal strings and stored as integer paise; no floating-point arithmetic is used to calculate balances.
- Total lent includes all entries. Total repaid includes fully settled entries. Outstanding excludes repaid entries. Overdue includes only unpaid entries due before today's date in `Asia/Kolkata`; entries due today are not overdue.
- Six-digit cryptographically random mock OTPs expire in five minutes, allow at most five guesses, and can be consumed once. Re-requests have a 30-second cooldown and a request cap. OTP hashes are keyed; session tokens are stored hashed in PostgreSQL and expire after seven days.
- Native tokens use Expo SecureStore. The web preview uses sessionStorage. Logout revokes the server-side session.
- Every loan and receipt query includes the authenticated user ID. Receipt images are private and limited to 5 MB, with PNG/JPEG/WebP signatures checked. No public upload directory is served.
- Empty, loading, validation, error, refresh, overdue and settled states are implemented. Repayment asks for confirmation.

## API

All protected endpoints use `Authorization: Bearer <token>`.

| Method / route | Input / result |
|---|---|
| `POST /auth/request-otp` | JSON `phone` in E.164 format; OTP printed to server log |
| `POST /auth/verify-otp` | JSON `phone`, `code`; returns token and user |
| `GET /me` | Current user |
| `POST /auth/logout` | Revoke current session |
| `GET /loans` | User's entries with overdue / receipt flags |
| `POST /loans` | JSON or multipart `friendName`, decimal-string `amount`, `dueDate`; optional multipart `receipt` |
| `PATCH /loans/:id/repay` | Mark fully repaid; safe to repeat |
| `GET /summary` | Total lent, repaid, outstanding, overdue in paise |
| `GET /loans/:id/receipt` | Authenticated image as a data URL |
| `GET /health` | API / PostgreSQL connectivity |

Example new entry:

```json
{"friendName":"Aarav","amount":"1250.50","dueDate":"2026-10-30"}
```

Source code contains no comments. See `docs/WALKTHROUGH.md` for the implementation explanation. Third-party dependencies retain their own notices.

## Submission checklist

Submit the GitHub repository URL with this README, and a 2-3 minute working screen recording link through Loom or Google Drive, as requested. Check video sharing permissions in a signed-out browser. The supplied message gives a deadline of 24 October 2026. No Internshala submission is performed by this project.

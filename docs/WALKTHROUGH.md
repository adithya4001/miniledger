# Explaining MiniLedger

## Where each part lives

`apps/api/src/index.ts` loads configuration, connects to PostgreSQL, creates tables and starts Express. `db.ts` owns the database schema. `app.ts` contains the routes, authentication and uploads. `validation.ts` converts money and validates phone numbers and dates.

`apps/mobile/src/App.tsx` contains the login screen, ledger, add-entry form, repayment confirmation and receipt viewer. `api.ts` handles requests, token storage, formatting and shared response types. Expo renders the same React Native components on Android, iOS and web.

## Login, step by step

The server generates a six-digit OTP, stores a keyed hash, and prints the original OTP only to the mock-login server log. The client never receives the OTP from the request endpoint. Verification locks the challenge row inside a transaction. A successful verification consumes the challenge and creates an opaque random session token. Its SHA-256 hash is saved, while the original token is returned to the client.

Subsequent requests send the bearer token. The server hashes it, looks up the unexpired session, and uses that session's user ID. Client-provided user IDs never decide record ownership.

## Why amounts are strings and paise

JavaScript decimal arithmetic can introduce rounding errors. The server validates the text first, splits rupees from paise and constructs an integer. For example, `"1250.29"` becomes `125029`. PostgreSQL sums integers. The UI divides by 100 only when displaying the amount.

## What makes an entry overdue

A date has no time zone. The server computes today's date in the configured business zone and compares the stored due date against it. A due date strictly before today is overdue, unless the entry has been repaid. This same rule is used for the list flag and summary amount.

## Why repayment is safe to repeat

`COALESCE(repaid_at, now())` fills the timestamp only if it is missing. A duplicate request leaves the original repayment time unchanged, so retries do not add money twice. Summary values are derived from the loan rows, not incremented client-side counters.

## Receipt handling

The client uses Expo ImagePicker. The server accepts one image up to 5 MB, checks its signature, assigns a UUID filename and saves it locally. Only the owner can retrieve it. If the database insert fails after the file is written, the file is removed. Hosted deployment would usually use private object storage instead of a local folder.

## Tests worth explaining

OTP replay and concurrent consumption verify one-time login. A second account cannot list, settle or view the first account's entries. Due-today and overdue entries produce different totals. A repeated repayment returns the same timestamp. Disguised and oversized uploads are rejected. Browser tests verify the exact displayed balances after adding and settling entries, not only whether buttons can be clicked.

## Tradeoffs

The app intentionally supports full repayments only. A growing product could add partial-payment rows, paginated lists, edit history, reminder jobs, a real OTP provider and shared receipt storage. The current mock OTP terminal log is an assignment requirement and is not a production authentication delivery channel.

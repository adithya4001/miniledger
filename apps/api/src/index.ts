import "dotenv/config";
import path from "node:path";
import { createPool, migrate } from "./db.js";
import { createApp } from "./app.js";

const { DATABASE_URL, AUTH_SECRET } = process.env;
if (!DATABASE_URL || !AUTH_SECRET || AUTH_SECRET.length < 32)
  throw new Error(
    "Set DATABASE_URL and an AUTH_SECRET of at least 32 characters in apps/api/.env.",
  );
const pool = createPool(DATABASE_URL);
await migrate(pool);
const timeZone = process.env.BUSINESS_TIME_ZONE ?? "Asia/Kolkata";
new Intl.DateTimeFormat("en", { timeZone }).format();
const app = createApp({
  pool,
  secret: AUTH_SECRET,
  origins: (process.env.APP_ORIGINS ?? "http://localhost:8081")
    .split(",")
    .map((value) => value.trim()),
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? "uploads"),
  timeZone,
});
const port = Number(process.env.PORT ?? 4100);
const server = app.listen(port, process.env.HOST ?? "0.0.0.0", () =>
  console.log(
    `MiniLedger API listening on port ${port}. Mock OTPs appear here.`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}

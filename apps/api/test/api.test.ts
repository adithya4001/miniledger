import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import supertest from "supertest";
import { createPool, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { loanSchema, todayInZone, validDate } from "../src/validation.js";
import { embeddedPool, injectedClient } from "./embedded.js";
import type pg from "pg";

const connection = process.env.INTEGRATION_DATABASE_URL;
const schema = `test_${randomUUID().replaceAll("-", "")}`;
const admin = connection ? createPool(connection) : null;
let pool: pg.Pool;
const logs: string[] = [];
let uploads = "";
let api: ReturnType<typeof supertest> | ReturnType<typeof injectedClient>;
let firstToken = "";
let secondToken = "";
let loanId = "";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVYQAAAAASUVORK5CYII=",
  "base64",
);

async function challenge(phone: string) {
  const response = await api
    .post("/auth/request-otp")
    .send({ phone })
    .expect(200);
  assert.equal("code" in response.body, false);
  return logs.at(-1)!.match(/: (\d{6}) /)![1];
}

async function login(phone: string) {
  const code = await challenge(phone);
  const response = await api
    .post("/auth/verify-otp")
    .send({ phone, code })
    .expect(200);
  return response.body.token as string;
}

before(async () => {
  if (connection && admin) {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = createPool(connection, `-c search_path=${schema}`);
    await migrate(pool);
  } else pool = await embeddedPool();
  uploads = await mkdtemp(path.join(tmpdir(), "miniledger-test-"));
  const app = createApp({
    pool,
    secret: "test-only-secret-of-more-than-32-characters",
    origins: ["http://localhost:8081"],
    uploadDir: uploads,
    timeZone: "Asia/Kolkata",
    logger: (text) => logs.push(text),
  });
  api = connection ? supertest(app) : injectedClient(app);
});

after(async () => {
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
  if (uploads) await rm(uploads, { recursive: true, force: true });
});

test("money is converted to exact integer paise and invalid dates/amounts are rejected", () => {
  assert.equal(
    loanSchema.parse({
      friendName: " A ",
      amount: "0.29",
      dueDate: "2028-02-29",
    }).amount,
    29,
  );
  for (const amount of ["0", "-5", "NaN", "1.001", "1e4", "1000000.01"])
    assert.equal(
      loanSchema.safeParse({ friendName: "A", amount, dueDate: "2026-10-23" })
        .success,
      false,
    );
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2026-13-01"), false);
  assert.equal(
    todayInZone("Asia/Kolkata", new Date("2026-10-22T19:00:00Z")),
    "2026-10-23",
  );
});

test("health and authentication boundaries", async () => {
  const response = await api.get("/health").expect(200);
  assert.equal(response.body.database, "postgresql");
  await api.get("/summary").expect(401);
  await api.get("/loans").set("Authorization", "Bearer invalid").expect(401);
  await api.post("/auth/request-otp").send({ phone: "123" }).expect(400);
  await api.post("/loans").send({}).expect(401);
});

test("mock OTP is server-side, throttled, one-use and stored hashed", async () => {
  const phone = "+919000000001";
  const code = await challenge(phone);
  await api.post("/auth/request-otp").send({ phone }).expect(429);
  const stored = (
    await pool.query("SELECT code_hash FROM otp_challenges WHERE phone = $1", [
      phone,
    ])
  ).rows[0];
  assert.notEqual(stored.code_hash, code);
  const result = await api
    .post("/auth/verify-otp")
    .send({ phone, code })
    .expect(200);
  firstToken = result.body.token;
  assert.match(firstToken, /^[a-f0-9]{64}$/);
  await api.post("/auth/verify-otp").send({ phone, code }).expect(400);
  assert.equal(
    (
      await api
        .get("/me")
        .set("Authorization", `Bearer ${firstToken}`)
        .expect(200)
    ).body.user.phone,
    phone,
  );
  assert.equal(
    (await pool.query("SELECT token_hash FROM sessions")).rows.some(
      (row) => row.token_hash === firstToken,
    ),
    false,
  );
});

test("expired OTP and five wrong attempts cannot log in", async () => {
  const phone = "+919000000003";
  const code = await challenge(phone);
  for (let i = 0; i < 5; i++)
    await api
      .post("/auth/verify-otp")
      .send({ phone, code: "000000" })
      .expect(400);
  await api.post("/auth/verify-otp").send({ phone, code }).expect(400);
  const expiredPhone = "+919000000004";
  const expiredCode = await challenge(expiredPhone);
  await pool.query(
    "UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE phone = $1",
    [expiredPhone],
  );
  await api
    .post("/auth/verify-otp")
    .send({ phone: expiredPhone, code: expiredCode })
    .expect(400);
});

test("the same OTP cannot be consumed twice concurrently", async () => {
  const phone = "+919000000005";
  const code = await challenge(phone);
  const results = await Promise.all([
    api.post("/auth/verify-otp").send({ phone, code }),
    api.post("/auth/verify-otp").send({ phone, code }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
});

test("loan creation, private receipt and summary agree exactly", async () => {
  const created = await api
    .post("/loans")
    .set("Authorization", `Bearer ${firstToken}`)
    .field("friendName", "Aarav")
    .field("amount", "1250.29")
    .field("dueDate", "2026-01-01")
    .attach("receipt", png, {
      filename: "receipt.png",
      contentType: "image/png",
    })
    .expect(201);
  loanId = created.body.id;
  const today = todayInZone("Asia/Kolkata");
  await api
    .post("/loans")
    .set("Authorization", `Bearer ${firstToken}`)
    .send({ friendName: "Meera", amount: "200", dueDate: today })
    .expect(201);
  const loans = (
    await api
      .get("/loans")
      .set("Authorization", `Bearer ${firstToken}`)
      .expect(200)
  ).body.loans;
  assert.equal(
    loans.find((loan: { id: string }) => loan.id === loanId).overdue,
    true,
  );
  assert.equal(
    loans.find((loan: { friendName: string }) => loan.friendName === "Meera")
      .overdue,
    false,
  );
  const summary = (
    await api
      .get("/summary")
      .set("Authorization", `Bearer ${firstToken}`)
      .expect(200)
  ).body;
  assert.equal(summary.totalLentPaise, 145029);
  assert.equal(summary.outstandingPaise, 145029);
  assert.equal(summary.overduePaise, 125029);
  const receipt = (
    await api
      .get(`/loans/${loanId}/receipt`)
      .set("Authorization", `Bearer ${firstToken}`)
      .expect(200)
  ).body;
  assert.equal(
    receipt.dataUrl,
    `data:image/png;base64,${png.toString("base64")}`,
  );
});

test("repayment is idempotent and removes the amount from overdue/outstanding", async () => {
  const one = await api
    .patch(`/loans/${loanId}/repay`)
    .set("Authorization", `Bearer ${firstToken}`)
    .expect(200);
  const two = await api
    .patch(`/loans/${loanId}/repay`)
    .set("Authorization", `Bearer ${firstToken}`)
    .expect(200);
  assert.equal(one.body.repaidAt, two.body.repaidAt);
  const summary = (
    await api
      .get("/summary")
      .set("Authorization", `Bearer ${firstToken}`)
      .expect(200)
  ).body;
  assert.equal(summary.totalRepaidPaise, 125029);
  assert.equal(summary.overduePaise, 0);
  assert.equal(summary.outstandingPaise, 20000);
});

test("one user cannot read or modify another user’s loans or receipts", async () => {
  secondToken = await login("+919000000002");
  assert.deepEqual(
    (
      await api
        .get("/loans")
        .set("Authorization", `Bearer ${secondToken}`)
        .expect(200)
    ).body.loans,
    [],
  );
  await api
    .patch(`/loans/${loanId}/repay`)
    .set("Authorization", `Bearer ${secondToken}`)
    .expect(404);
  await api
    .get(`/loans/${loanId}/receipt`)
    .set("Authorization", `Bearer ${secondToken}`)
    .expect(404);
});

test("invalid input, disguised uploads and oversized receipts are rejected", async () => {
  for (const body of [
    { friendName: "", amount: "1", dueDate: "2026-10-23" },
    { friendName: "A", amount: "1.001", dueDate: "2026-10-23" },
    { friendName: "A", amount: "1", dueDate: "2026-02-30" },
  ])
    await api
      .post("/loans")
      .set("Authorization", `Bearer ${firstToken}`)
      .send(body)
      .expect(400);
  await api
    .post("/loans")
    .set("Authorization", `Bearer ${firstToken}`)
    .field("friendName", "A")
    .field("amount", "1")
    .field("dueDate", "2026-10-23")
    .attach("receipt", Buffer.from("<script>bad</script>"), {
      filename: "fake.png",
      contentType: "image/png",
    })
    .expect(400);
  await api
    .post("/loans")
    .set("Authorization", `Bearer ${firstToken}`)
    .field("friendName", "A")
    .field("amount", "1")
    .field("dueDate", "2026-10-23")
    .attach("receipt", Buffer.alloc(5 * 1024 * 1024 + 1), "huge.png")
    .expect(413);
});

test("logout revokes a session and an expired session is rejected", async () => {
  await api
    .post("/auth/logout")
    .set("Authorization", `Bearer ${secondToken}`)
    .expect(204);
  await api
    .get("/summary")
    .set("Authorization", `Bearer ${secondToken}`)
    .expect(401);
  await pool.query(
    "UPDATE sessions SET expires_at = now() - interval '1 second'",
  );
  await api
    .get("/summary")
    .set("Authorization", `Bearer ${firstToken}`)
    .expect(401);
});

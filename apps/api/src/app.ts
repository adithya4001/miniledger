import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import {
  createHash,
  createHmac,
  randomInt,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { ZodError, z } from "zod";
import {
  loanSchema,
  requestOtpSchema,
  verifyOtpSchema,
  todayInZone,
} from "./validation.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      tokenHash?: string;
    }
  }
}

export interface AppConfig {
  pool: pg.Pool;
  secret: string;
  origins: string[];
  uploadDir: string;
  timeZone: string;
  logger?: (message: string) => void;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const uuid = z.string().uuid();

export function createApp(config: AppConfig) {
  const app = express();
  const pool = config.pool;
  const log = config.logger ?? console.log;
  const otpHash = (phone: string, code: string) =>
    createHmac("sha256", config.secret)
      .update(`${phone}:${code}`)
      .digest("hex");
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.origins }));
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/auth",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many attempts. Please try again later." },
    }),
  );

  const authenticate = async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ) => {
    const token = req.headers.authorization?.match(
      /^Bearer ([a-f0-9]{64})$/,
    )?.[1];
    if (!token) throw new ApiError(401, "Please sign in to continue.");
    const hash = tokenHash(token);
    const result = await pool.query(
      "SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()",
      [hash],
    );
    if (!result.rowCount)
      throw new ApiError(401, "Your session expired. Please sign in again.");
    req.userId = result.rows[0].user_id;
    req.tokenHash = hash;
    next();
  };

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "postgresql" });
  });

  app.post("/auth/request-otp", async (req, res) => {
    const { phone } = requestOtpSchema.parse(req.body);
    const code = String(randomInt(100000, 1000000));
    const result = await pool.query(
      `
      INSERT INTO otp_challenges (phone, code_hash, expires_at)
      VALUES ($1, $2, now() + interval '5 minutes')
      ON CONFLICT (phone) DO UPDATE SET
        code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
        attempts = 0, requested_at = now(),
        request_count = CASE WHEN otp_challenges.window_started < now() - interval '15 minutes' THEN 1 ELSE otp_challenges.request_count + 1 END,
        window_started = CASE WHEN otp_challenges.window_started < now() - interval '15 minutes' THEN now() ELSE otp_challenges.window_started END
      WHERE otp_challenges.requested_at < now() - interval '30 seconds'
        AND (otp_challenges.request_count < 5 OR otp_challenges.window_started < now() - interval '15 minutes')
      RETURNING phone`,
      [phone, otpHash(phone, code)],
    );
    if (!result.rowCount)
      throw new ApiError(
        429,
        "Please wait before requesting another OTP. Maximum five requests per 15 minutes.",
      );
    log(`[MOCK OTP] ${phone}: ${code} (valid for 5 minutes)`);
    res.json({
      message:
        "OTP generated. For this assignment, read it in the backend terminal.",
      expiresInSeconds: 300,
    });
  });

  app.post("/auth/verify-otp", async (req, res) => {
    const { phone, code } = verifyOtpSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT *, expires_at > now() AS valid FROM otp_challenges WHERE phone = $1 FOR UPDATE",
        [phone],
      );
      const challenge = result.rows[0];
      if (!challenge || !challenge.valid || challenge.attempts >= 5)
        throw new ApiError(
          400,
          "OTP expired or unavailable. Request a new one.",
        );
      if (
        !timingSafeEqual(
          Buffer.from(challenge.code_hash, "hex"),
          Buffer.from(otpHash(phone, code), "hex"),
        )
      ) {
        await client.query(
          "UPDATE otp_challenges SET attempts = attempts + 1 WHERE phone = $1",
          [phone],
        );
        await client.query("COMMIT");
        res.status(400).json({ error: "Incorrect OTP. Please try again." });
        return;
      }
      await client.query("DELETE FROM otp_challenges WHERE phone = $1", [
        phone,
      ]);
      const user = await client.query(
        "INSERT INTO users (id, phone) VALUES ($1, $2) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id, phone",
        [randomUUID(), phone],
      );
      const token = randomBytes(32).toString("hex");
      await client.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')",
        [tokenHash(token), user.rows[0].id],
      );
      await client.query("COMMIT");
      res.json({ token, user: user.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/me", authenticate, async (req, res) => {
    const result = await pool.query(
      "SELECT id, phone FROM users WHERE id = $1",
      [req.userId],
    );
    res.json({ user: result.rows[0] });
  });

  app.post("/auth/logout", authenticate, async (req, res) => {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [
      req.tokenHash,
    ]);
    res.status(204).end();
  });

  app.get("/loans", authenticate, async (req, res) => {
    const result = await pool.query(
      `SELECT id, friend_name AS "friendName", amount_paise AS "amountPaise",
      to_char(due_date, 'YYYY-MM-DD') AS "dueDate", repaid_at AS "repaidAt", created_at AS "createdAt",
      receipt_name IS NOT NULL AS "hasReceipt", (repaid_at IS NULL AND due_date < $2::date) AS overdue
      FROM loans WHERE user_id = $1 ORDER BY created_at DESC, id`,
      [req.userId, todayInZone(config.timeZone)],
    );
    res.json({ loans: result.rows, today: todayInZone(config.timeZone) });
  });

  app.get("/summary", authenticate, async (req, res) => {
    const result = await pool.query(
      `SELECT
      COALESCE(SUM(amount_paise), 0)::bigint AS lent,
      COALESCE(SUM(amount_paise) FILTER (WHERE repaid_at IS NOT NULL), 0)::bigint AS repaid,
      COALESCE(SUM(amount_paise) FILTER (WHERE repaid_at IS NULL), 0)::bigint AS outstanding,
      COALESCE(SUM(amount_paise) FILTER (WHERE repaid_at IS NULL AND due_date < $2::date), 0)::bigint AS overdue,
      COUNT(*)::int AS count
      FROM loans WHERE user_id = $1`,
      [req.userId, todayInZone(config.timeZone)],
    );
    const row = result.rows[0];
    res.json({
      totalLentPaise: Number(row.lent),
      totalRepaidPaise: Number(row.repaid),
      outstandingPaise: Number(row.outstanding),
      overduePaise: Number(row.overdue),
      entryCount: row.count,
      today: todayInZone(config.timeZone),
      currency: "INR",
    });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3, parts: 4 },
  });
  app.post(
    "/loans",
    authenticate,
    upload.single("receipt"),
    async (req, res) => {
      const values = loanSchema.parse(req.body);
      const id = randomUUID();
      let receiptName: string | null = null;
      let mime: string | null = null;
      if (req.file) {
        const bytes = req.file.buffer;
        const png = bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        const webp =
          bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP";
        if (!png && !jpeg && !webp)
          throw new ApiError(400, "Upload a PNG, JPEG or WebP receipt image.");
        mime = png ? "image/png" : jpeg ? "image/jpeg" : "image/webp";
        receiptName = `${id}.${png ? "png" : jpeg ? "jpg" : "webp"}`;
        await mkdir(config.uploadDir, { recursive: true });
        await writeFile(path.join(config.uploadDir, receiptName), bytes, {
          flag: "wx",
        });
      }
      try {
        await pool.query(
          "INSERT INTO loans (id, user_id, friend_name, amount_paise, due_date, receipt_name, receipt_mime) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [
            id,
            req.userId,
            values.friendName,
            values.amount,
            values.dueDate,
            receiptName,
            mime,
          ],
        );
      } catch (error) {
        if (receiptName)
          await unlink(path.join(config.uploadDir, receiptName)).catch(
            () => {},
          );
        throw error;
      }
      res.status(201).json({ id });
    },
  );

  app.patch("/loans/:id/repay", authenticate, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const result = await pool.query(
      'UPDATE loans SET repaid_at = COALESCE(repaid_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id, repaid_at AS "repaidAt"',
      [id, req.userId],
    );
    if (!result.rowCount) throw new ApiError(404, "Loan entry not found.");
    res.json(result.rows[0]);
  });

  app.get("/loans/:id/receipt", authenticate, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const result = await pool.query(
      "SELECT receipt_name, receipt_mime FROM loans WHERE id = $1 AND user_id = $2",
      [id, req.userId],
    );
    if (!result.rowCount || !result.rows[0].receipt_name)
      throw new ApiError(404, "Receipt not found.");
    const file = result.rows[0];
    const bytes = await readFile(
      path.join(config.uploadDir, file.receipt_name),
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({
      dataUrl: `data:${file.receipt_mime};base64,${bytes.toString("base64")}`,
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint not found." });
  });
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof ZodError) {
        res
          .status(400)
          .json({ error: error.issues[0]?.message ?? "Invalid request." });
        return;
      }
      if (error instanceof ApiError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof multer.MulterError) {
        res
          .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
          .json({
            error:
              error.code === "LIMIT_FILE_SIZE"
                ? "Receipt must be smaller than 5 MB."
                : "Invalid upload. Attach one receipt image.",
          });
        return;
      }
      if (error instanceof SyntaxError && "body" in error) {
        res.status(400).json({ error: "Invalid JSON body." });
        return;
      }
      console.error(
        "Unexpected API error:",
        error instanceof Error ? error.message : "Unknown error",
      );
      res
        .status(500)
        .json({ error: "Something went wrong. Please try again." });
    },
  );
  return app;
}

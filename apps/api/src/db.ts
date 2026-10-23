import pg from "pg";

export const schema = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS otp_challenges (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_started TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_name TEXT NOT NULL CHECK (length(friend_name) BETWEEN 1 AND 80),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  due_date DATE NOT NULL,
  repaid_at TIMESTAMPTZ,
  receipt_name TEXT,
  receipt_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loans_user_created_idx ON loans(user_id, created_at DESC);
`;

export function createPool(connectionString: string, options?: string) {
  return new pg.Pool({
    connectionString,
    options,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
}

export async function migrate(pool: pg.Pool) {
  await pool.query(schema);
}

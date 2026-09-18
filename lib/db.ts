/**
 * Database abstraction — Neon Free (serverless Postgres).
 * Only task metadata is stored. Never repository contents.
 *
 * Env: DATABASE_URL (Neon connection string)
 *
 * PRODUCTION RULE: if NODE_ENV=production and DATABASE_URL is missing,
 * getSql() throws so the app cannot silently fall back to memory.
 * Development still allows the in-memory fallback in tasks.ts.
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';

let sql: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> | null {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DATABASE_URL is required in production. Set a Neon Free connection string.'
      );
    }
    return null; // development-only memory fallback
  }
  if (!sql) {
    sql = neon(url);
  }
  return sql;
}

export async function ensureSchema(): Promise<void> {
  const db = getSql();
  if (!db) return;

  await db`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      repository    TEXT NOT NULL,
      title         TEXT,
      prompt        TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'QUEUED',
      branch        TEXT NOT NULL DEFAULT 'main',
      commit_sha    TEXT,
      pr_url        TEXT,
      deployment_url TEXT,
      worker_run_id TEXT,
      error         TEXT,
      result        TEXT,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      worker_lease  TEXT,
      heartbeat_at  TIMESTAMPTZ,
      steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at    TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await db`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks (user_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)`;
  await db`CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks (updated_at)`;
  await db`CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks (user_id, status)`;
}

/**
 * Task repository — metadata only.
 * Uses Neon when DATABASE_URL is set; otherwise falls back to in-memory Map
 * so local development continues to work without a database.
 */

import { getSql, ensureSchema } from './db';

export type TaskStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_FOR_INPUT'
  | 'TESTING'
  | 'FIXING'
  | 'COMMITTING'
  | 'PUSHING'
  | 'DEPLOYING'
  | 'VERIFYING'
  | 'PR_CREATED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Task {
  id: string;
  userId: string;
  repository: string; // owner/repo
  title?: string;
  branch: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  workerLease?: string;
  heartbeatAt?: string;
  workerRunId?: string;
  retryCount: number;
  result?: string;
  error?: string;
  commitSha?: string;
  prUrl?: string;
  deploymentUrl?: string;
  steps: TaskStep[];
}

export interface TaskStep {
  id: string;
  name: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: string;
  completedAt?: string;
  detail?: string;
}

// ---------- In-memory fallback (local / no DATABASE_URL) ----------
const _store = new Map<string, Task>();

function rowToTask(row: any): Task {
  return {
    id: row.id,
    userId: row.user_id,
    repository: row.repository,
    title: row.title ?? undefined,
    branch: row.branch,
    prompt: row.prompt,
    status: row.status as TaskStatus,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    startedAt: row.started_at ? (row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at)) : undefined,
    completedAt: row.completed_at ? (row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at)) : undefined,
    // Do not expose the worker callback credential through normal task reads.
    heartbeatAt: row.heartbeat_at ? (row.heartbeat_at instanceof Date ? row.heartbeat_at.toISOString() : String(row.heartbeat_at)) : undefined,
    workerRunId: row.worker_run_id ?? undefined,
    retryCount: Number(row.retry_count ?? 0),
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    commitSha: row.commit_sha ?? undefined,
    prUrl: row.pr_url ?? undefined,
    deploymentUrl: row.deployment_url ?? undefined,
    steps: Array.isArray(row.steps) ? row.steps : (typeof row.steps === 'string' ? JSON.parse(row.steps || '[]') : []),
  };
}

export async function createTask(
  partial: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'retryCount' | 'status' | 'steps'> & { title?: string }
): Promise<Task> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const workerLease = partial.workerLease || crypto.randomUUID();
  const task: Task = {
    ...partial,
    workerLease,
    id,
    status: 'QUEUED',
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    steps: [],
  };

  const db = getSql();
  if (db) {
    await ensureSchema();
    await db`
      INSERT INTO tasks (
        id, user_id, repository, title, prompt, status, branch,
        retry_count, worker_lease, steps, created_at, updated_at
      ) VALUES (
        ${task.id}, ${task.userId}, ${task.repository}, ${task.title ?? null},
        ${task.prompt}, ${task.status}, ${task.branch},
        ${task.retryCount}, ${task.workerLease}, ${JSON.stringify(task.steps)}, ${task.createdAt}, ${task.updatedAt}
      )
    `;
  } else {
    _store.set(id, task);
  }
  return task;
}

export async function getTask(id: string, userId?: string): Promise<Task | undefined> {
  const db = getSql();
  if (db) {
    await ensureSchema();
    const rows = userId
      ? await db`SELECT * FROM tasks WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
      : await db`SELECT * FROM tasks WHERE id = ${id} LIMIT 1`;
    if (!rows || rows.length === 0) return undefined;
    return rowToTask(rows[0]);
  }
  const t = _store.get(id);
  if (!t) return undefined;
  if (userId && t.userId !== userId) return undefined;
  return t;
}


export async function getTaskWorkerLease(id: string): Promise<string | undefined> {
  const db = getSql();
  if (db) {
    await ensureSchema();
    const rows = await db`SELECT worker_lease FROM tasks WHERE id = ${id} LIMIT 1`;
    return rows?.[0]?.worker_lease ?? undefined;
  }
  return _store.get(id)?.workerLease;
}

export async function listTasks(userId: string): Promise<Task[]> {
  const db = getSql();
  if (db) {
    await ensureSchema();
    const rows = await db`
      SELECT * FROM tasks
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return (rows || []).map(rowToTask);
  }
  return Array.from(_store.values())
    .filter((t) => t.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateTask(
  id: string,
  patch: Partial<Task>,
  userId?: string
): Promise<Task | undefined> {
  const existing = await getTask(id, userId);
  if (!existing) return undefined;

  const next: Task = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  // Derive startedAt / completedAt when status changes
  if (patch.status === 'RUNNING' && !next.startedAt) {
    next.startedAt = next.updatedAt;
  }
  if (
    (patch.status === 'COMPLETED' ||
      patch.status === 'FAILED' ||
      patch.status === 'CANCELLED' ||
      patch.status === 'PR_CREATED') &&
    !next.completedAt
  ) {
    next.completedAt = next.updatedAt;
  }

  const db = getSql();
  if (db) {
    await db`
      UPDATE tasks SET
        status = ${next.status},
        title = ${next.title ?? null},
        branch = ${next.branch},
        commit_sha = ${next.commitSha ?? null},
        pr_url = ${next.prUrl ?? null},
        deployment_url = ${next.deploymentUrl ?? null},
        worker_run_id = ${next.workerRunId ?? null},
        error = ${next.error ?? null},
        result = ${next.result ?? null},
        retry_count = ${next.retryCount},
        worker_lease = ${next.workerLease ?? null},
        heartbeat_at = ${next.heartbeatAt ?? null},
        started_at = ${next.startedAt ?? null},
        completed_at = ${next.completedAt ?? null},
        steps = ${JSON.stringify(next.steps)},
        updated_at = ${next.updatedAt}
      WHERE id = ${id}
    `;
  } else {
    _store.set(id, next);
  }
  return next;
}

export async function appendTaskStep(
  id: string,
  step: Omit<TaskStep, 'id' | 'startedAt'> & { id?: string; startedAt?: string }
): Promise<Task | undefined> {
  const existing = await getTask(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const incoming: TaskStep = {
    id: step.id || crypto.randomUUID(),
    name: step.name,
    status: step.status,
    startedAt: step.startedAt || now,
    completedAt: step.completedAt,
    detail: step.detail,
  };
  const steps = [...(existing.steps || [])];
  const index = steps.findIndex(s => s.id === incoming.id);
  if (index >= 0) steps[index] = { ...steps[index], ...incoming };
  else steps.push(incoming);
  return updateTask(id, { steps });
}

export async function deleteTask(id: string, userId: string): Promise<boolean> {
  const db = getSql();
  if (db) {
    await ensureSchema();
    const result = await db`DELETE FROM tasks WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    return Array.isArray(result) && result.length > 0;
  }
  const existing = _store.get(id);
  if (!existing || existing.userId !== userId) return false;
  _store.delete(id);
  return true;
}

/** Soft cleanup of old completed tasks (called by scheduled job or on demand) */
export async function cleanupOldTasks(days = 30): Promise<number> {
  const db = getSql();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await db`
    DELETE FROM tasks
    WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED')
      AND updated_at < ${cutoff}
  `;
  // neon returns array; rowCount is not always present — approximate
  return Array.isArray(result) ? result.length : 0;
}

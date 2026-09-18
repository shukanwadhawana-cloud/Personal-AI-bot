/** Compact task model — only metadata is persisted */
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
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Task {
  id: string;
  userId: string;
  repository: string; // owner/repo
  branch: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  workerLease?: string;
  heartbeatAt?: string;
  retryCount: number;
  result?: string;
  error?: string;
  commitSha?: string;
  prUrl?: string;
  deploymentUrl?: string;
}

// In production this is backed by Cloudflare D1 / Neon / etc.
// For the skeleton we keep an in-memory placeholder (replace before real use).
const _store = new Map<string, Task>();

export function createTask(partial: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'retryCount' | 'status'>): Task {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const task: Task = {
    ...partial,
    id,
    status: 'QUEUED',
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
  };
  _store.set(id, task);
  return task;
}

export function getTask(id: string): Task | undefined {
  return _store.get(id);
}

export function listTasks(userId: string): Task[] {
  return Array.from(_store.values()).filter((t) => t.userId === userId);
}

export function updateTask(id: string, patch: Partial<Task>): Task | undefined {
  const t = _store.get(id);
  if (!t) return undefined;
  const next = { ...t, ...patch, updatedAt: new Date().toISOString() };
  _store.set(id, next);
  return next;
}

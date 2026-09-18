import { NextRequest, NextResponse } from 'next/server';
import { getTask, updateTask } from '@/lib/tasks';
import { requireUser } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const task = await getTask(params.id, auth.userId);
  if (!task) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(task);
}

/**
 * PATCH is used in two modes:
 * 1. Authenticated user — can only update their own task; limited fields.
 * 2. Worker callback — identified by x-worker-secret; can update status/result fields
 *    without a user session (ownership already established at creation time).
 *
 * Protected fields (userId, createdAt, id) are never accepted from the body.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const secret = req.headers.get('x-worker-secret');
  const expected = process.env.WORKER_CALLBACK_SECRET;
  const isWorker = Boolean(expected && secret && secret === expected);

  const auth = await requireUser();

  if (!auth && !isWorker) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Only these fields may ever be written via PATCH
    const allowed = [
      'status',
      'error',
      'result',
      'commitSha',
      'prUrl',
      'deploymentUrl',
      'workerRunId',
      'heartbeatAt',
      'workerLease',
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    // Users cannot escalate status to COMPLETED/PR_CREATED themselves
    // (only the worker should do that). Allow CANCELLED for the owner.
    if (auth && !isWorker) {
      if (
        patch.status &&
        !['CANCELLED', 'WAITING_FOR_INPUT'].includes(String(patch.status))
      ) {
        return NextResponse.json(
          { error: 'Users may only set status to CANCELLED or WAITING_FOR_INPUT' },
          { status: 403 }
        );
      }
      // Users cannot set commit/PR fields
      delete patch.commitSha;
      delete patch.prUrl;
      delete patch.deploymentUrl;
      delete patch.workerRunId;
      delete patch.workerLease;
      delete patch.heartbeatAt;
    }

    // Worker path: do not pass userId so updateTask can find the row by id alone.
    // User path: enforce ownership.
    const userId = isWorker ? undefined : auth!.userId;
    const task = await updateTask(params.id, patch as any, userId);
    if (!task) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(task);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error' }, { status: 500 });
  }
}

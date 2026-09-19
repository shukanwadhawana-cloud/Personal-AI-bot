import { NextRequest, NextResponse } from 'next/server';
import { appendTaskStep, deleteTask, getTask, getTaskWorkerLease, updateTask } from '@/lib/tasks';
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const deleted = await deleteTask(params.id, auth.userId);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error' }, { status: 500 });
  }
}

/**
 * Worker authentication (either is enough):
 * 1. x-worker-secret === process.env.WORKER_CALLBACK_SECRET
 * 2. x-worker-token === stored per-task worker_lease
 *
 * Users must be signed in and may only set CANCELLED / WAITING_FOR_INPUT.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const secretHeader = req.headers.get('x-worker-secret')?.trim() || '';
  const tokenHeader = req.headers.get('x-worker-token')?.trim() || '';
  const expectedSecret = (process.env.WORKER_CALLBACK_SECRET || '').trim();
  const lease = (await getTaskWorkerLease(params.id))?.trim() || '';

  const secretOk = Boolean(expectedSecret && secretHeader && secretHeader === expectedSecret);
  const tokenOk = Boolean(lease && tokenHeader && tokenHeader === lease);
  const isWorker = secretOk || tokenOk;

  const auth = await requireUser();

  if (!auth && !isWorker) {
    return NextResponse.json(
      {
        error: 'Unauthorized',
        hint: 'Worker must send x-worker-secret (shared) and/or x-worker-token (per-task lease).',
      },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();

    if (isWorker && body.step?.name) {
      const task = await appendTaskStep(params.id, {
        id: body.step.id,
        name: String(body.step.name).slice(0, 120),
        status: ['RUNNING', 'COMPLETED', 'FAILED'].includes(body.step.status)
          ? body.step.status
          : 'RUNNING',
        startedAt: body.step.startedAt,
        completedAt: body.step.completedAt,
        detail: body.step.detail ? String(body.step.detail).slice(0, 2000) : undefined,
      });
      if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(task);
    }

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
      delete patch.commitSha;
      delete patch.prUrl;
      delete patch.deploymentUrl;
      delete patch.workerRunId;
      delete patch.workerLease;
      delete patch.heartbeatAt;
    }

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

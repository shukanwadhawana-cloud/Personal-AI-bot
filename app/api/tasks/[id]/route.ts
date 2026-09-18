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

/** Internal callback from GitHub Actions worker — protected by a shared secret */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const secret = req.headers.get('x-worker-secret');
  const expected = process.env.WORKER_CALLBACK_SECRET;

  // Allow either authenticated user (manual update) or worker with shared secret
  const auth = await requireUser();
  const isWorker = expected && secret === expected;

  if (!auth && !isWorker) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
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

    const patch: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    const userId = auth?.userId; // worker updates may omit ownership check
    const task = await updateTask(params.id, patch, userId);
    if (!task) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(task);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Error' }, { status: 500 });
  }
}

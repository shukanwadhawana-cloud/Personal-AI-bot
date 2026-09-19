import { NextRequest, NextResponse } from 'next/server';
import { createTask, getTask, getTaskWorkerLease, listTasks, updateTask } from '@/lib/tasks';
import { requireUser } from '@/lib/auth';
import { z } from 'zod';
import { getToken } from 'next-auth/jwt';

const CreateTaskSchema = z.object({
  repository: z
    .string()
    .min(3)
    .max(200)
    .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, 'Must be owner/repo'),
  branch: z.string().min(1).max(200).default('main'),
  prompt: z.string().min(5).max(8000),
  title: z.string().max(200).optional(),
});

/**
 * ONLY this workflow ID is known-good for workflow_dispatch (verified 2026-09-19):
 *   id: 362081304
 *   path: .github/workflows/gold-worker.yml
 *   name: Gold Worker
 *
 * coding-agent.yml and coding-agent-dispatch.yml return GitHub 422
 * "Workflow does not have workflow_dispatch trigger" despite containing the key in YAML.
 * A stale Vercel env CODING_AGENT_WORKFLOW must not override this.
 */
const GOLD_WORKER_WORKFLOW_ID = '362081304';

function resolveWorkflowRef(): string {
  const fromEnv = (process.env.CODING_AGENT_WORKFLOW_ID || '').trim();
  // Only accept numeric IDs from env (or gold-worker.yml). Reject known-broken filenames.
  if (fromEnv && /^\d+$/.test(fromEnv)) return fromEnv;
  if (fromEnv === 'gold-worker.yml') return fromEnv;
  return GOLD_WORKER_WORKFLOW_ID;
}

export async function GET() {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await listTasks(auth.userId));
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = CreateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { repository, branch, prompt, title } = parsed.data;
    const task = await createTask({
      userId: auth.userId,
      repository,
      branch,
      prompt,
      title: title || prompt.slice(0, 80),
    });

    const controlPlaneRepo =
      process.env.CONTROL_PLANE_REPO || 'shukanwadhawana-cloud/Personal-AI-bot';
    const workflowRef = resolveWorkflowRef();
    const dispatchUrl = `https://api.github.com/repos/${controlPlaneRepo}/actions/workflows/${workflowRef}/dispatches`;

    const sessionToken = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: process.env.NODE_ENV === 'production',
    });
    const token =
      process.env.GITHUB_TOKEN ||
      process.env.AGENT_GITHUB_TOKEN ||
      (sessionToken as any)?.githubAccessToken;

    const callbackUrl = `${req.nextUrl.origin}/api/tasks/${task.id}`;
    const callbackToken = await getTaskWorkerLease(task.id);

    if (!token) {
      await updateTask(
        task.id,
        {
          status: 'FAILED',
          error:
            'GitHub authorization is not available. Sign out and sign in with GitHub again, or configure AGENT_GITHUB_TOKEN.',
        },
        auth.userId
      );
    } else {
      try {
        const res = await fetch(dispatchUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ref: 'main',
            inputs: {
              task_id: task.id,
              target_repo: repository,
              target_branch: branch,
              prompt,
              callback_url: callbackUrl,
              callback_token: callbackToken || '',
            },
          }),
        });

        if (res.ok || res.status === 204) {
          await updateTask(task.id, { status: 'QUEUED' }, auth.userId);
        } else {
          const responseText = await res.text().catch(() => '');
          console.error('Dispatch failed', res.status, responseText);
          await updateTask(
            task.id,
            {
              status: 'FAILED',
              error: `GitHub Actions dispatch failed (${res.status}) workflow=${workflowRef}. ${responseText.slice(0, 1000)}`,
            },
            auth.userId
          );
        }
      } catch (e: any) {
        console.error('Dispatch failed', e);
        await updateTask(
          task.id,
          {
            status: 'FAILED',
            error: `GitHub Actions dispatch error: ${e?.message || 'unknown error'}`,
          },
          auth.userId
        );
      }
    }

    const finalTask = await getTask(task.id, auth.userId);
    return NextResponse.json(
      { id: task.id, status: finalTask?.status || task.status },
      { status: 201 }
    );
  } catch (e: any) {
    console.error('POST /api/tasks error', e?.message || e);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

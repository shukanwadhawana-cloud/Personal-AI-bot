import { NextRequest, NextResponse } from 'next/server';
import { createTask, listTasks, updateTask } from '@/lib/tasks';
import { requireUser } from '@/lib/auth';
import { z } from 'zod';

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

export async function GET() {
  const auth = await requireUser();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tasks = await listTasks(auth.userId);
  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
    const dispatchUrl = `https://api.github.com/repos/${controlPlaneRepo}/actions/workflows/coding-agent.yml/dispatches`;
    const token = process.env.GITHUB_TOKEN || process.env.AGENT_GITHUB_TOKEN;

    // Build the full callback URL that includes the task id
    const baseCallback = process.env.CALLBACK_URL; // e.g. https://app.vercel.app/api/tasks
    const callbackUrl = baseCallback
      ? `${baseCallback.replace(/\/$/, '')}/${task.id}`
      : '';

    if (token) {
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
            },
          }),
        });
        if (res.ok || res.status === 204) {
          await updateTask(task.id, { status: 'RUNNING' }, auth.userId);
        } else {
          const text = await res.text().catch(() => '');
          console.error('Dispatch failed', res.status, text);
        }
      } catch (e) {
        console.error('Dispatch failed', e);
      }
    }

    return NextResponse.json(
      { id: task.id, status: task.status },
      { status: 201 }
    );
  } catch (e: any) {
    console.error('POST /api/tasks error', e?.message || e);
    return NextResponse.json(
      { error: e.message || 'Internal error' },
      { status: 500 }
    );
  }
}

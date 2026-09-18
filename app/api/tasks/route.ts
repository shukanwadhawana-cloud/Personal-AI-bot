import { NextRequest, NextResponse } from 'next/server';
import { createTask, listTasks, updateTask } from '@/lib/tasks';
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

// NOTE: Auth will be enforced in Phase 3B. Until then a demo user is used
// so the existing UI continues to function while the DB is verified.
const DEMO_USER = 'demo-user';

export async function GET() {
  const tasks = await listTasks(DEMO_USER);
  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
  try {
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
      userId: DEMO_USER,
      repository,
      branch,
      prompt,
      title: title || prompt.slice(0, 80),
    });

    // Fire-and-forget dispatch to GitHub Actions
    const controlPlaneRepo =
      process.env.CONTROL_PLANE_REPO || 'shukanwadhawana-cloud/Personal-AI-bot';
    const dispatchUrl = `https://api.github.com/repos/${controlPlaneRepo}/actions/workflows/coding-agent.yml/dispatches`;
    const token = process.env.GITHUB_TOKEN || process.env.AGENT_GITHUB_TOKEN;

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
              callback_url: process.env.CALLBACK_URL || '',
            },
          }),
        });
        if (res.ok || res.status === 204) {
          await updateTask(task.id, { status: 'RUNNING' });
        }
      } catch (e) {
        console.error('Dispatch failed', e);
        // Task remains QUEUED; can be retried later
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

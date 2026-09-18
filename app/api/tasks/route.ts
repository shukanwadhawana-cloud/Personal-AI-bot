import { NextRequest, NextResponse } from 'next/server';
import { createTask, listTasks } from '@/lib/tasks';

// NOTE: Replace the in-memory store with a real free DB before production use.
// Dispatch to GitHub Actions is performed here when secrets are present.

export async function GET() {
  // In real app: filter by authenticated user
  const tasks = listTasks('demo-user');
  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { repository, branch = 'main', prompt } = body;
    if (!repository || !prompt) {
      return NextResponse.json({ error: 'repository and prompt required' }, { status: 400 });
    }

    const task = createTask({
      userId: 'demo-user', // replace with real auth
      repository,
      branch,
      prompt,
    });

    // Fire-and-forget dispatch to GitHub Actions (requires GITHUB_TOKEN with workflow scope
    // and the workflow file present). In production use octokit or fetch to api.github.com.
    const dispatchUrl = `https://api.github.com/repos/${process.env.CONTROL_PLANE_REPO || 'shukanwadhawana-cloud/Personal-AI-bot'}/actions/workflows/coding-agent.yml/dispatches`;
    const token = process.env.GITHUB_TOKEN || process.env.AGENT_GITHUB_TOKEN;

    if (token) {
      try {
        await fetch(dispatchUrl, {
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
        // Mark running optimistically
        // updateTask(task.id, { status: 'RUNNING' });
      } catch (e) {
        console.error('Dispatch failed', e);
      }
    }

    return NextResponse.json({ id: task.id, status: task.status }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

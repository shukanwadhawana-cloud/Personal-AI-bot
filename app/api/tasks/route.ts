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
 * Authoritative workflow for dispatch. GitHub accepts the BARE filename only
 * (pai-worker.yml). Full paths like .github/workflows/pai-worker.yml return 404.
 *
 * Do not use numeric IDs from older broken registrations (gold-worker 362081304,
 * coding-agent*, personal-ai-agent when name shows as path string).
 */
const WORKFLOW_FILE = 'pai-worker.yml';

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
    const workflowRef = WORKFLOW_FILE;
    const dispatchUrl = `https://api.github.com/repos/${controlPlaneRepo}/actions/workflows/${encodeURIComponent(workflowRef)}/dispatches`;

    // Prefer the currently authenticated GitHub OAuth token. A stale server-side
    // PAT must not shadow a fresh token obtained from the user's current login.
    // GitHub returns 401 for invalid/revoked credentials; in that case we can
    // safely fall back to an explicitly configured server token.
    const sessionToken = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: process.env.NODE_ENV === 'production',
    });
    const oauthToken = (sessionToken as any)?.githubAccessToken as string | undefined;
    const configuredTokens = [
      { source: 'oauth', token: oauthToken },
      { source: 'agent_pat', token: process.env.AGENT_GITHUB_TOKEN },
      { source: 'github_token', token: process.env.GITHUB_TOKEN },
    ].filter((candidate): candidate is { source: string; token: string } => Boolean(candidate.token));

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
        const payload = {
          ref: 'main',
          inputs: {
            task_id: task.id,
            target_repo: repository,
            target_branch: branch,
            prompt,
            callback_url: callbackUrl,
            callback_token: callbackToken || '',
          },
        };

        let lastStatus = 0;
        let lastResponse = '';
        let successfulSource = '';

        for (const candidate of configuredTokens) {
          const res = await fetch(dispatchUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${candidate.token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });

          lastStatus = res.status;
          lastResponse = await res.text().catch(() => '');

          if (res.ok || res.status === 204) {
            successfulSource = candidate.source;
            console.info('GitHub Actions dispatch accepted', {
              repository: controlPlaneRepo,
              workflow: workflowRef,
              ref: 'main',
              authSource: candidate.source,
            });
            break;
          }

          // A 401 means these credentials themselves are invalid/revoked.
          // Try the next configured credential without exposing token material.
          if (res.status !== 401) break;
        }

        if (successfulSource) {
          await updateTask(task.id, { status: 'QUEUED' }, auth.userId);
        } else {
          const responseText = lastResponse.slice(0, 800);
          const credentialHint = lastStatus === 401
            ? 'GitHub rejected every configured credential (401 Bad credentials). Re-authorize the GitHub OAuth app or replace the server PAT in Vercel.'
            : lastStatus === 403
              ? 'GitHub authenticated the request but denied workflow dispatch. Ensure the credential has Actions: write access (or repo scope for a classic OAuth/PAT).'
              : '';
          console.error('Dispatch failed', lastStatus, {
            repository: controlPlaneRepo,
            workflow: workflowRef,
            authSourcesTried: configuredTokens.map((candidate) => candidate.source),
            response: responseText,
          });
          await updateTask(
            task.id,
            {
              status: 'FAILED',
              error: [
                'GitHub Actions dispatch failed',
                `repository=${controlPlaneRepo}`,
                `workflow=${workflowRef}`,
                'ref=main',
                `status=${lastStatus}`,
                credentialHint,
                `response=${responseText}`,
              ].filter(Boolean).join(' | '),
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

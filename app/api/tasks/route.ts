import { NextRequest, NextResponse } from 'next/server';
import { createTask, getTask, getTaskWorkerLease, listTasks, updateTask } from '@/lib/tasks';
import { requireUser } from '@/lib/auth';
import { z } from 'zod';
import { getToken } from 'next-auth/jwt';
import {
  formatProbeSummary,
  probeGitHubCredential,
  type CredentialProbe,
  type CredentialSource,
} from '@/lib/github-credentials';

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

    // Prefer the currently authenticated GitHub OAuth token from the encrypted JWT.
    // A valid NextAuth session does NOT guarantee the stored GitHub token is still valid.
    const sessionToken = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: process.env.NODE_ENV === 'production',
    });
    const oauthToken = (sessionToken as { githubAccessToken?: string } | null)?.githubAccessToken;

    const candidates: { source: CredentialSource; token: string | undefined }[] = [
      { source: 'oauth', token: oauthToken },
      { source: 'agent_pat', token: process.env.AGENT_GITHUB_TOKEN },
      { source: 'github_token', token: process.env.GITHUB_TOKEN },
    ];

    const callbackUrl = `${req.nextUrl.origin}/api/tasks/${task.id}`;
    const callbackToken = await getTaskWorkerLease(task.id);

    // Probe each credential against GitHub before attempting dispatch.
    const probes: CredentialProbe[] = [];
    for (const c of candidates) {
      const probe = await probeGitHubCredential(c.token, c.source, controlPlaneRepo);
      probes.push(probe);
      // Safe server log — never includes token material.
      console.info('github_credential_probe', {
        source: probe.source,
        configured: probe.configured,
        accepted: probe.accepted,
        status: probe.status,
        login: probe.login || null,
        reason: probe.reason || null,
      });
    }

    const usable = probes.filter((p) => p.accepted);
    if (usable.length === 0) {
      const summary = formatProbeSummary(probes);
      console.error('dispatch_aborted_no_valid_credential', { summary });
      await updateTask(
        task.id,
        {
          status: 'FAILED',
          error: [
            'GitHub authorization is not available for workflow dispatch.',
            'A valid NextAuth session does not guarantee a valid GitHub Actions token.',
            'Use Reconnect GitHub on the dashboard to obtain a fresh OAuth token with repo+workflow scopes,',
            'or configure a valid AGENT_GITHUB_TOKEN (classic PAT with repo + workflow, or fine-grained with Actions: write).',
            `probes=${summary}`,
          ].join(' '),
        },
        auth.userId
      );
      const finalTask = await getTask(task.id, auth.userId);
      return NextResponse.json(
        { id: task.id, status: finalTask?.status || 'FAILED' },
        { status: 201 }
      );
    }

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

      for (const probe of usable) {
        const token =
          probe.source === 'oauth'
            ? oauthToken
            : probe.source === 'agent_pat'
              ? process.env.AGENT_GITHUB_TOKEN
              : process.env.GITHUB_TOKEN;
        if (!token) continue;

        const res = await fetch(dispatchUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        lastStatus = res.status;
        lastResponse = await res.text().catch(() => '');

        if (res.ok || res.status === 204) {
          successfulSource = probe.source;
          console.info('GitHub Actions dispatch accepted', {
            repository: controlPlaneRepo,
            workflow: workflowRef,
            ref: 'main',
            authSource: probe.source,
            login: probe.login || null,
          });
          break;
        }

        console.error('Dispatch attempt failed', {
          authSource: probe.source,
          status: res.status,
          // response body may contain GitHub message; no token
          response: lastResponse.slice(0, 400),
        });

        // 401/403: try next accepted credential; other errors stop.
        if (res.status !== 401 && res.status !== 403) break;
      }

      if (successfulSource) {
        await updateTask(task.id, { status: 'QUEUED' }, auth.userId);
      } else {
        const responseText = lastResponse.slice(0, 800);
        const credentialHint =
          lastStatus === 401
            ? 'GitHub rejected the credential at dispatch (401). Reconnect GitHub or replace AGENT_GITHUB_TOKEN.'
            : lastStatus === 403
              ? 'GitHub authenticated but denied workflow_dispatch (403). Need Actions write / workflow scope on the credential.'
              : lastStatus === 404
                ? 'Workflow not found (404). Confirm pai-worker.yml is registered on main.'
                : lastStatus === 422
                  ? 'Workflow dispatch rejected (422). workflow_dispatch may be missing or inputs invalid.'
                  : '';
        console.error('Dispatch failed', {
          status: lastStatus,
          repository: controlPlaneRepo,
          workflow: workflowRef,
          probes: formatProbeSummary(probes),
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
              `probes=${formatProbeSummary(probes)}`,
              `response=${responseText}`,
            ]
              .filter(Boolean)
              .join(' | '),
          },
          auth.userId
        );
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error';
      console.error('Dispatch failed', message);
      await updateTask(
        task.id,
        {
          status: 'FAILED',
          error: `GitHub Actions dispatch error: ${message}`,
        },
        auth.userId
      );
    }

    const finalTask = await getTask(task.id, auth.userId);
    return NextResponse.json(
      { id: task.id, status: finalTask?.status || task.status },
      { status: 201 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Internal error';
    console.error('POST /api/tasks error', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Server-only helpers for validating GitHub credentials used by the control plane.
 * Never log token values, Authorization headers, or secrets.
 */

export type CredentialSource = 'oauth' | 'agent_pat' | 'github_token';

export type CredentialProbe = {
  source: CredentialSource;
  configured: boolean;
  accepted: boolean;
  status: number;
  login?: string;
  /** Short reason suitable for server logs / task error (no secrets). */
  reason?: string;
};

const GH_API = 'https://api.github.com';
const GH_HEADERS_BASE = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
} as const;

/**
 * Probe a GitHub token: identity + access to the control-plane repository.
 * Does not dispatch a workflow; that is a separate step after a probe succeeds.
 */
export async function probeGitHubCredential(
  token: string | undefined | null,
  source: CredentialSource,
  controlPlaneRepo: string
): Promise<CredentialProbe> {
  if (!token) {
    return {
      source,
      configured: false,
      accepted: false,
      status: 0,
      reason: 'not_configured',
    };
  }

  try {
    const userRes = await fetch(`${GH_API}/user`, {
      headers: {
        ...GH_HEADERS_BASE,
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (userRes.status === 401) {
      return {
        source,
        configured: true,
        accepted: false,
        status: 401,
        reason: 'bad_credentials',
      };
    }

    if (userRes.status === 403) {
      return {
        source,
        configured: true,
        accepted: false,
        status: 403,
        reason: 'forbidden_or_rate_limited',
      };
    }

    if (!userRes.ok) {
      return {
        source,
        configured: true,
        accepted: false,
        status: userRes.status,
        reason: `user_api_${userRes.status}`,
      };
    }

    const userBody = (await userRes.json().catch(() => ({}))) as { login?: string };
    const login = typeof userBody.login === 'string' ? userBody.login : undefined;

    // Confirm the credential can see the control-plane repository (needed for Actions dispatch).
    const repoRes = await fetch(`${GH_API}/repos/${controlPlaneRepo}`, {
      headers: {
        ...GH_HEADERS_BASE,
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (repoRes.status === 401) {
      return {
        source,
        configured: true,
        accepted: false,
        status: 401,
        login,
        reason: 'bad_credentials_on_repo',
      };
    }

    if (repoRes.status === 404) {
      return {
        source,
        configured: true,
        accepted: false,
        status: 404,
        login,
        reason: 'repo_not_found_or_no_access',
      };
    }

    if (repoRes.status === 403) {
      return {
        source,
        configured: true,
        accepted: false,
        status: 403,
        login,
        reason: 'repo_forbidden',
      };
    }

    if (!repoRes.ok) {
      return {
        source,
        configured: true,
        accepted: false,
        status: repoRes.status,
        login,
        reason: `repo_api_${repoRes.status}`,
      };
    }

    return {
      source,
      configured: true,
      accepted: true,
      status: 200,
      login,
      reason: 'ok',
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'network_error';
    return {
      source,
      configured: true,
      accepted: false,
      status: 0,
      reason: `network:${message.slice(0, 120)}`,
    };
  }
}

export function formatProbeSummary(probes: CredentialProbe[]): string {
  return probes
    .map((p) => {
      const bits = [
        p.source,
        p.configured ? 'configured' : 'missing',
        p.accepted ? 'accepted' : 'rejected',
        `http=${p.status}`,
      ];
      if (p.login) bits.push(`login=${p.login}`);
      if (p.reason) bits.push(`reason=${p.reason}`);
      return bits.join('/');
    })
    .join(' | ');
}

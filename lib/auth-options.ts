import type { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';

/**
 * Scopes required for Actions workflow_dispatch on private/public repos:
 * - read:user / user:email: identity
 * - repo: repository access for dispatch target resolution
 * - workflow: update GitHub Actions workflow files + dispatch
 */
const GITHUB_OAUTH_SCOPES = 'read:user user:email repo workflow';

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID || '',
      clientSecret: process.env.GITHUB_SECRET || '',
      authorization: {
        params: {
          scope: GITHUB_OAUTH_SCOPES,
        },
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        if (account.access_token) {
          (token as any).githubAccessToken = account.access_token;
        }
        if (account.providerAccountId) {
          token.githubId = String(account.providerAccountId);
        }
      }
      if (profile) {
        const p = profile as { id?: number | string; login?: string };
        if (p.id != null) token.githubId = String(p.id);
        if (p.login) token.login = p.login;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.githubId || token.sub;
        (session.user as any).login = token.login;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  useSecureCookies: process.env.NODE_ENV === 'production',
  pages: {
    error: '/',
  },
};

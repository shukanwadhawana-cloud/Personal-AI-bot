import type { NextAuthOptions } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID || '',
      clientSecret: process.env.GITHUB_SECRET || '',
      // Request identity plus repository access needed for Actions dispatch and future repo operations.
      authorization: { params: { scope: 'read:user user:email repo' } },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        // Persist the GitHub numeric id for stable ownership
        token.githubId = (profile as any).id?.toString();
        token.login = (profile as any).login;
        // Keep the provider token inside NextAuth's encrypted JWT so server routes
        // can call GitHub on the signed-in user's behalf without exposing it to the browser.
        (token as any).githubAccessToken = account.access_token;
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
  // Secure cookies in production
  useSecureCookies: process.env.NODE_ENV === 'production',
};

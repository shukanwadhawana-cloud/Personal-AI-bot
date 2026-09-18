import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function getSession() {
  return getServerSession(authOptions);
}

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) {
    return null;
  }
  // Prefer stable GitHub id; fall back to email or name
  const userId =
    (session.user as any).id ||
    session.user.email ||
    session.user.name ||
    'unknown';
  return { session, userId: String(userId) };
}

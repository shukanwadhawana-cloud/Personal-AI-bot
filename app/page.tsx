'use client';

import { useEffect, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';

type Task = {
  id: string;
  repository: string;
  title?: string;
  status: string;
  createdAt: string;
  prUrl?: string;
};

const statusLabel: Record<string, string> = {
  RUNNING: 'Running',
  TESTING: 'Testing',
  FIXING: 'Fixing',
  VERIFYING: 'Verifying',
  COMMITTING: 'Committing',
  PUSHING: 'Pushing',
  PR_CREATED: 'PR created',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  QUEUED: 'Queued',
};

export default function Home() {
  const { data: session, status } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function deleteTask(id: string) {
    if (!window.confirm('Delete this task from the dashboard? This only removes the task record.')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (res.ok) setTasks((current) => current.filter((t) => t.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/tasks')
      .then((r) => (r.ok ? r.json() : []))
      .then(setTasks)
      .catch(() => setTasks([]));
  }, [status]);

  const authenticated = status === 'authenticated';

  return (
    <main style={{ minHeight: '100vh', background: '#f7f8fa', color: '#17181c', fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '28px 18px 48px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 750, letterSpacing: '-0.03em' }}>Personal AI Bot</div>
            <div style={{ color: '#686d78', fontSize: 13, marginTop: 5 }}>Gold Worker · AI coding tasks</div>
          </div>
          {authenticated ? (
            <button onClick={() => signOut()} style={{ background: '#fff', border: '1px solid #dfe2e8', color: '#3b3f47', borderRadius: 10, padding: '9px 12px', fontSize: 13, cursor: 'pointer' }}>
              Sign out
            </button>
          ) : (
            <button onClick={() => signIn('github')} style={{ background: '#17181c', color: '#fff', border: 0, borderRadius: 10, padding: '10px 14px', fontWeight: 650, cursor: 'pointer' }}>
              Sign in with GitHub
            </button>
          )}
        </header>

        <section style={{ background: '#fff', border: '1px solid #e2e5ea', borderRadius: 18, padding: 24, boxShadow: '0 8px 30px rgba(20,25,35,.05)', marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 7 }}>Create a new coding task</div>
          <div style={{ color: '#686d78', fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>
            Describe what you want the Gold Worker to build, fix, test, or improve.
          </div>
          {authenticated ? (
            <a href="/tasks/new" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '11px 17px', background: '#17181c', color: '#fff', borderRadius: 10, textDecoration: 'none', fontWeight: 650, fontSize: 14 }}>
              + New coding task
            </a>
          ) : (
            <button onClick={() => signIn('github')} style={{ padding: '11px 17px', background: '#17181c', color: '#fff', border: 0, borderRadius: 10, fontWeight: 650, cursor: 'pointer' }}>
              Sign in to start
            </button>
          )}
        </section>

        <section style={{ background: '#f0f7f2', border: '1px solid #d3e5d8', borderRadius: 15, padding: '15px 17px', marginBottom: 26 }}>
          <div style={{ color: '#24633a', fontSize: 14, fontWeight: 700 }}>● Gold Worker operational</div>
          <div style={{ color: '#55705d', fontSize: 12.5, marginTop: 5, lineHeight: 1.45 }}>
            Dispatch, Gemini/Aider, verification, callbacks and PR creation are connected.
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <h2 style={{ fontSize: 18, margin: 0, letterSpacing: '-0.02em' }}>Recent tasks</h2>
            {authenticated && tasks.length > 0 && <span style={{ color: '#858a94', fontSize: 12 }}>{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>}
          </div>

          {!authenticated && <div style={{ background: '#fff', border: '1px solid #e2e5ea', borderRadius: 14, padding: 18, color: '#686d78', fontSize: 14 }}>Sign in to see and create tasks.</div>}
          {authenticated && tasks.length === 0 && <div style={{ background: '#fff', border: '1px solid #e2e5ea', borderRadius: 14, padding: 18, color: '#686d78', fontSize: 14 }}>No tasks yet.</div>}

          <div style={{ display: 'grid', gap: 10 }}>
            {tasks.map((t) => {
              const label = statusLabel[t.status] || t.status.replaceAll('_', ' ');
              const done = ['COMPLETED', 'PR_CREATED'].includes(t.status);
              const failed = t.status === 'FAILED';
              return (
                <div key={t.id} style={{ background: '#fff', border: '1px solid #e2e5ea', borderRadius: 14, padding: 16, boxShadow: '0 3px 14px rgba(20,25,35,.035)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <a href={`/tasks/${t.id}`} style={{ color: '#17181c', textDecoration: 'none', flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, overflowWrap: 'anywhere' }}>{t.title || t.id.slice(0, 8)}</div>
                      <div style={{ color: '#777c86', fontSize: 12.5, lineHeight: 1.45 }}>
                        {t.repository} · {new Date(t.createdAt).toLocaleString()}
                      </div>
                    </a>
                    <span style={{ flexShrink: 0, padding: '5px 9px', borderRadius: 999, background: failed ? '#fff0f0' : done ? '#eef8f1' : '#f1f3f6', color: failed ? '#a52d2d' : done ? '#24633a' : '#4f5560', fontSize: 11.5, fontWeight: 700 }}>
                      {label}
                    </span>
                  </div>
                  {t.prUrl && (
                    <div style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid #eef0f3' }}>
                      <a href={t.prUrl} target="_blank" rel="noreferrer" style={{ color: '#315fd4', fontSize: 13, fontWeight: 650, textDecoration: 'none' }}>
                        View pull request ↗
                      </a>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <button type="button" onClick={() => deleteTask(t.id)} disabled={deleting === t.id} aria-label={`Delete ${t.title || 'task'}`} style={{ border: 0, background: 'transparent', color: '#8a4a4a', borderRadius: 7, padding: '5px 7px', fontSize: 12, cursor: deleting === t.id ? 'wait' : 'pointer' }}>
                      {deleting === t.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <footer style={{ marginTop: 38, textAlign: 'center', fontSize: 11.5, color: '#9499a2' }}>
          ₹0 target · GitHub Actions execution
        </footer>
      </div>
    </main>
  );
}

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

export default function Home() {
  const { data: session, status } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/tasks')
      .then((r) => (r.ok ? r.json() : []))
      .then(setTasks)
      .catch(() => setTasks([]));
  }, [status]);

  return (
    <main style={{ fontFamily: 'system-ui', padding: '1.5rem', maxWidth: 640, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Personal AI Bot</h1>
        {status === 'authenticated' ? (
          <button
            onClick={() => signOut()}
            style={{ background: 'none', border: '1px solid #ccc', borderRadius: 6, padding: '6px 12px' }}
          >
            Sign out ({(session?.user as any)?.login || session?.user?.name})
          </button>
        ) : (
          <button
            onClick={() => signIn('github')}
            style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px' }}
          >
            Sign in with GitHub
          </button>
        )}
      </header>

      <p style={{ color: '#555', marginBottom: 24 }}>
        Persistent cloud coding agent. Phone can lock — the task continues on GitHub Actions.
      </p>

      {status === 'authenticated' && (
        <section style={{ marginBottom: 32 }}>
          <a
            href="/tasks/new"
            style={{
              display: 'inline-block',
              padding: '12px 20px',
              background: '#111',
              color: '#fff',
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            + New Coding Task
          </a>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recent tasks</h2>
        {status !== 'authenticated' && (
          <p style={{ color: '#666' }}>Sign in to see and create tasks.</p>
        )}
        {status === 'authenticated' && tasks.length === 0 && (
          <p style={{ color: '#666' }}>No tasks yet.</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {tasks.map((t) => (
            <li key={t.id} style={{ marginBottom: 12, padding: 12, background: '#f3f4f6', borderRadius: 8 }}>
              <a href={`/tasks/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ fontWeight: 600 }}>{t.title || t.id.slice(0, 8)}</div>
                <div style={{ fontSize: 13, color: '#555' }}>
                  {t.repository} · {t.status} · {new Date(t.createdAt).toLocaleString()}
                </div>
                {t.prUrl && (
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    <a href={t.prUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      View PR
                    </a>
                  </div>
                )}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <footer style={{ marginTop: 48, fontSize: 12, color: '#888' }}>
        ₹0 target · OpenHands-inspired · GitHub Actions execution
      </footer>
    </main>
  );
}

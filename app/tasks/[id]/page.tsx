'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

type Task = {
  id: string;
  repository: string;
  title?: string;
  prompt: string;
  status: string;
  branch: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  commitSha?: string;
  prUrl?: string;
  deploymentUrl?: string;
  workerRunId?: string;
  llmCalls?: number;
  provider?: string;
  model?: string;
  error?: string;
  result?: string;
  steps?: { id: string; name: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED'; startedAt: string; completedAt?: string; detail?: string }[];
};

const STATUS_COLORS: Record<string, string> = {
  QUEUED: '#666',
  RUNNING: '#2563eb',
  TESTING: '#7c3aed',
  FIXING: '#c026d3',
  COMMITTING: '#0891b2',
  PUSHING: '#0d9488',
  PR_CREATED: '#16a34a',
  COMPLETED: '#16a34a',
  FAILED: '#dc2626',
  CANCELLED: '#9ca3af',
};

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'PR_CREATED']);
const CONTROL_PLANE_REPO = 'shukanwadhawana-cloud/Personal-AI-bot';

export default function TaskDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const statusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/tasks/${id}`);
        if (res.status === 401) {
          if (!cancelled) {
            setError('Please sign in');
            setLoading(false);
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setError('Task not found');
            setLoading(false);
          }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setTask(data);
          statusRef.current = data.status;
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load');
          setLoading(false);
        }
      }
    }

    load();
    const interval = setInterval(() => {
      if (statusRef.current && TERMINAL.has(statusRef.current)) return;
      load();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  if (loading) {
    return (
      <main style={pageStyle}>
        <p>Loading task…</p>
      </main>
    );
  }

  if (error || !task) {
    return (
      <main style={pageStyle}>
        <p style={{ color: 'crimson' }}>{error || 'Not found'}</p>
        <a href="/">← Dashboard</a>
      </main>
    );
  }

  const color = STATUS_COLORS[task.status] || '#333';

  async function handleDelete() {
    if (!window.confirm('Delete this task from the dashboard? This only removes the task record.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (res.ok) window.location.href = '/';
      else setDeleting(false);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: 4 }}>
        {task.title || task.id.slice(0, 8)}
      </h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 16 }}>
        {task.repository} · {task.branch}
      </p>

      <div
        style={{
          display: 'inline-block',
          padding: '6px 14px',
          borderRadius: 999,
          background: color,
          color: '#fff',
          fontWeight: 600,
          fontSize: 14,
          marginBottom: 20,
        }}
      >
        {task.status}
      </div>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Steps</h2>
        {(!task.steps || task.steps.length === 0) ? (
          <p style={{ color: '#777', fontSize: 14 }}>Waiting for worker…</p>
        ) : (
          <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {task.steps.map((step, index) => (
              <li key={step.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid #eee' }}>
                <span style={{ width: 24, height: 24, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: step.status === 'COMPLETED' ? '#16a34a' : step.status === 'FAILED' ? '#dc2626' : '#2563eb', color: '#fff', flexShrink: 0 }}>
                  {step.status === 'COMPLETED' ? '✓' : step.status === 'FAILED' ? '!' : index + 1}
                </span>
                <div><div style={{ fontWeight: 600 }}>{step.name}</div><div style={{ fontSize: 12, color: '#777' }}>{new Date(step.startedAt).toLocaleString()}{step.completedAt ? ' → ' + new Date(step.completedAt).toLocaleString() : ' · in progress'}</div>{step.detail && <div style={{ fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap' }}>{step.detail}</div>}</div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Prompt</h2>
        <pre style={preStyle}>{task.prompt}</pre>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>Timeline</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14 }}>
          <li>Created: {new Date(task.createdAt).toLocaleString()}</li>
          {task.startedAt && <li>Started: {new Date(task.startedAt).toLocaleString()}</li>}
          {task.completedAt && <li>Completed: {new Date(task.completedAt).toLocaleString()}</li>}
          <li>Updated: {new Date(task.updatedAt).toLocaleString()}</li>
        </ul>
      </section>

      {(task.commitSha || task.prUrl || task.deploymentUrl || task.workerRunId) && (
        <section style={sectionStyle}>
          <h2 style={h2Style}>Results</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14 }}>
            {task.provider && <li>LLM provider: <code>{task.provider}</code>{task.model ? ` · ${task.model}` : ""}{typeof task.llmCalls === "number" ? ` · ${task.llmCalls} call${task.llmCalls === 1 ? "" : "s"}` : ""}</li>}
            {task.workerRunId && (
              <li>
                Worker run:{' '}
                <a
                  href={`https://github.com/${CONTROL_PLANE_REPO}/actions/runs/${task.workerRunId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {task.workerRunId}
                </a>
              </li>
            )}
            {task.commitSha && (
              <li>
                Commit: <code>{task.commitSha.slice(0, 7)}</code>
              </li>
            )}
            {task.prUrl && (
              <li>
                PR:{' '}
                <a href={task.prUrl} target="_blank" rel="noreferrer">
                  {task.prUrl}
                </a>
              </li>
            )}
            {task.deploymentUrl && (
              <li>
                Deployment:{' '}
                <a href={task.deploymentUrl} target="_blank" rel="noreferrer">
                  {task.deploymentUrl}
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      {task.error && (
        <section style={sectionStyle}>
          <h2 style={{ ...h2Style, color: 'crimson' }}>Error</h2>
          <pre style={{ ...preStyle, color: 'crimson' }}>{task.error}</pre>
        </section>
      )}

      {task.result && (
        <section style={sectionStyle}>
          <h2 style={h2Style}>Summary</h2>
          <pre style={preStyle}>{task.result}</pre>
        </section>
      )}

      <p style={{ marginTop: 32 }}>
        <a href="/">← Dashboard</a>
        {' · '}
        <a href="/tasks/new">New task</a>
        {' · '}
        <button type="button" onClick={handleDelete} disabled={deleting} style={{ border: 'none', background: 'none', color: '#b91c1c', padding: 0, cursor: deleting ? 'wait' : 'pointer' }}>
          {deleting ? 'Deleting…' : 'Delete task'}
        </button>
      </p>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: 'system-ui',
  padding: '1.5rem',
  maxWidth: 640,
  margin: '0 auto',
};
const sectionStyle: React.CSSProperties = { marginBottom: 24 };
const h2Style: React.CSSProperties = {
  fontSize: 14,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#666',
  marginBottom: 8,
};
const preStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: '#f3f4f6',
  padding: 12,
  borderRadius: 8,
  fontSize: 14,
  margin: 0,
};

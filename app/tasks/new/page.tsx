'use client';

import { useState } from 'react';

export default function NewTaskPage() {
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setMessage('');
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repository: repo, branch, prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setStatus('done');
      setMessage(`Task ${data.id} queued. You can lock your phone — it will continue on GitHub Actions.`);
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || 'Error');
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: '1.5rem', maxWidth: 640, margin: '0 auto' }}>
      <h1>New Coding Task</h1>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          Repository (owner/name)
          <input
            required
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="yourname/your-repo"
            style={{ display: 'block', width: '100%', padding: 10, marginTop: 4 }}
          />
        </label>
        <label>
          Base branch
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 10, marginTop: 4 }}
          />
        </label>
        <label>
          Prompt
          <textarea
            required
            rows={6}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Inspect this repository, identify one safe improvement, implement it, run the relevant tests, and create a pull request."
            style={{ display: 'block', width: '100%', padding: 10, marginTop: 4 }}
          />
        </label>
        <button
          type="submit"
          disabled={status === 'submitting'}
          style={{ padding: '12px 20px', background: '#111', color: '#fff', border: 'none', borderRadius: 8 }}
        >
          {status === 'submitting' ? 'Starting…' : 'START'}
        </button>
      </form>
      {message && (
        <p style={{ marginTop: 16, color: status === 'error' ? 'crimson' : 'green' }}>{message}</p>
      )}
      <p style={{ marginTop: 24 }}>
        <a href="/">← Dashboard</a>
      </p>
    </main>
  );
}

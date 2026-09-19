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
  RUNNING: 'Running', TESTING: 'Testing', FIXING: 'Fixing', VERIFYING: 'Verifying',
  COMMITTING: 'Committing', PUSHING: 'Pushing', PR_CREATED: 'PR created',
  COMPLETED: 'Completed', FAILED: 'Failed', QUEUED: 'Queued',
};

const statusTone = (status: string) => {
  if (status === 'FAILED') return { bg: '#fff1f2', fg: '#b42318', dot: '#d92d20' };
  if (['COMPLETED', 'PR_CREATED'].includes(status)) return { bg: '#ecfdf3', fg: '#027a48', dot: '#12b76a' };
  return { bg: '#f2f4f7', fg: '#475467', dot: '#667085' };
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
    } finally { setDeleting(null); }
  }

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/tasks').then((r) => (r.ok ? r.json() : [])).then(setTasks).catch(() => setTasks([]));
  }, [status]);

  const authenticated = status === 'authenticated';

  return (
    <main style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#f8fafc 0%,#f4f6f8 100%)', color: '#101828', fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', padding: '24px 16px 56px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <header style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, padding:'8px 2px 28px' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:36,height:36,borderRadius:11,background:'#101828',color:'#fff',display:'grid',placeItems:'center',fontWeight:800,fontSize:14 }}>AI</div>
              <div>
                <div style={{ fontSize:24,fontWeight:780,letterSpacing:'-.035em' }}>Personal AI Bot</div>
                <div style={{ color:'#667085',fontSize:12.5,marginTop:3 }}>Gold Worker · AI coding tasks</div>
              </div>
            </div>
          </div>
          {authenticated ? (
            <button onClick={() => signOut()} style={{ background:'#fff',border:'1px solid #d0d5dd',color:'#344054',borderRadius:10,padding:'9px 12px',fontSize:12.5,fontWeight:650,cursor:'pointer' }}>Sign out</button>
          ) : (
            <button onClick={() => signIn('github')} style={{ background:'#101828',color:'#fff',border:0,borderRadius:10,padding:'10px 14px',fontWeight:700,cursor:'pointer' }}>Sign in with GitHub</button>
          )}
        </header>

        <section style={{ background:'#fff',border:'1px solid #e4e7ec',borderRadius:20,padding:'22px',boxShadow:'0 10px 32px rgba(16,24,40,.06)',marginBottom:14 }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16 }}>
            <div>
              <div style={{ fontSize:18,fontWeight:750,letterSpacing:'-.02em' }}>Create a new coding task</div>
              <div style={{ color:'#667085',fontSize:13.5,lineHeight:1.5,marginTop:6,maxWidth:570 }}>Describe what you want the Gold Worker to build, fix, test, or improve.</div>
            </div>
            <div style={{ display:'none' }} />
          </div>
          <div style={{ marginTop:18 }}>
            {authenticated ? (
              <a href="/tasks/new" style={{ display:'inline-flex',alignItems:'center',justifyContent:'center',gap:7,padding:'11px 17px',background:'#101828',color:'#fff',borderRadius:10,textDecoration:'none',fontWeight:700,fontSize:13.5 }}>＋ New coding task</a>
            ) : (
              <button onClick={() => signIn('github')} style={{ padding:'11px 17px',background:'#101828',color:'#fff',border:0,borderRadius:10,fontWeight:700,cursor:'pointer' }}>Sign in to start</button>
            )}
          </div>
        </section>

        <section style={{ background:'#effaf3',border:'1px solid #ccebd7',borderRadius:16,padding:'14px 16px',marginBottom:28,display:'flex',alignItems:'center',gap:12 }}>
          <span style={{ width:10,height:10,borderRadius:'50%',background:'#12b76a',boxShadow:'0 0 0 4px #d9fbe8',flexShrink:0 }} />
          <div style={{ minWidth:0 }}>
            <div style={{ color:'#067647',fontSize:13.5,fontWeight:750 }}>Gold Worker operational</div>
            <div style={{ color:'#47715a',fontSize:12.5,marginTop:3,lineHeight:1.4 }}>Dispatch · Gemini/Aider · verification · callbacks · PR creation</div>
          </div>
        </section>

        <section>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
            <div>
              <h2 style={{ fontSize:18,margin:0,letterSpacing:'-.025em' }}>Recent tasks</h2>
              <div style={{ color:'#98a2b3',fontSize:12,marginTop:3 }}>{authenticated ? 'Your latest coding runs' : 'Sign in to view your runs'}</div>
            </div>
            {authenticated && tasks.length > 0 && <span style={{ color:'#667085',fontSize:12,fontWeight:650 }}>{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>}
          </div>

          {!authenticated && <div style={{ background:'#fff',border:'1px solid #e4e7ec',borderRadius:16,padding:20,color:'#667085',fontSize:14 }}>Sign in to see and create tasks.</div>}
          {authenticated && tasks.length === 0 && <div style={{ background:'#fff',border:'1px solid #e4e7ec',borderRadius:16,padding:24,color:'#667085',fontSize:14,textAlign:'center' }}>No tasks yet. Start your first coding task above.</div>}

          <div style={{ display:'grid',gap:10 }}>
            {tasks.map((t) => {
              const label = statusLabel[t.status] || t.status.replaceAll('_',' ');
              const tone = statusTone(t.status);
              return (
                <article key={t.id} style={{ background:'#fff',border:'1px solid #e4e7ec',borderRadius:16,padding:17,boxShadow:'0 4px 16px rgba(16,24,40,.035)' }}>
                  <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:14 }}>
                    <a href={`/tasks/${t.id}`} style={{ color:'#101828',textDecoration:'none',flex:1,minWidth:0 }}>
                      <div style={{ fontWeight:730,fontSize:14.5,marginBottom:6,overflowWrap:'anywhere' }}>{t.title || `Task ${t.id.slice(0,8)}`}</div>
                      <div style={{ color:'#667085',fontSize:12.5,lineHeight:1.45 }}>{t.repository}</div>
                      <div style={{ color:'#98a2b3',fontSize:11.5,marginTop:3 }}>{new Date(t.createdAt).toLocaleString()}</div>
                    </a>
                    <span style={{ flexShrink:0,display:'inline-flex',alignItems:'center',gap:6,padding:'6px 9px',borderRadius:999,background:tone.bg,color:tone.fg,fontSize:11.5,fontWeight:750 }}>
                      <span style={{ width:6,height:6,borderRadius:'50%',background:tone.dot }} />{label}
                    </span>
                  </div>
                  {(t.prUrl || authenticated) && (
                    <div style={{ marginTop:13,paddingTop:11,borderTop:'1px solid #f0f2f5',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10 }}>
                      {t.prUrl ? <a href={t.prUrl} target="_blank" rel="noreferrer" style={{ color:'#175cd3',fontSize:12.5,fontWeight:700,textDecoration:'none' }}>View pull request ↗</a> : <span style={{ color:'#98a2b3',fontSize:12 }}>Worker is processing…</span>}
                      <button type="button" onClick={() => deleteTask(t.id)} disabled={deleting === t.id} style={{ border:0,background:'transparent',color:'#b42318',borderRadius:7,padding:'5px 7px',fontSize:11.5,fontWeight:650,cursor:deleting === t.id ? 'wait' : 'pointer' }}>{deleting === t.id ? 'Deleting…' : 'Delete'}</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <footer style={{ marginTop:40,textAlign:'center',fontSize:11.5,color:'#98a2b3' }}>₹0 target · GitHub Actions execution</footer>
      </div>
    </main>
  );
}

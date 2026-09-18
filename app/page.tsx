export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: '1.5rem', maxWidth: 640, margin: '0 auto' }}>
      <h1>Personal AI Bot</h1>
      <p>Persistent cloud coding agent. Phone can lock — the task continues.</p>
      <section style={{ marginTop: '2rem' }}>
        <a href="/tasks/new" style={{ display: 'inline-block', padding: '12px 20px', background: '#111', color: '#fff', borderRadius: 8, textDecoration: 'none' }}>
          + New Coding Task
        </a>
      </section>
      <section style={{ marginTop: '2rem' }}>
        <h2>Running / Recent</h2>
        <p style={{ color: '#666' }}>Task list will appear here after control-plane wiring (Phase 2 continued).</p>
      </section>
      <footer style={{ marginTop: '3rem', fontSize: 12, color: '#888' }}>
        ₹0 target · OpenHands-inspired · GitHub Actions execution
      </footer>
    </main>
  );
}

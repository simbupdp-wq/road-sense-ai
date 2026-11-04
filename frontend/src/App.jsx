import React, { useState } from 'react';
import { MapPinned, ShieldCheck } from 'lucide-react';
import AuthorityView from './AuthorityView.jsx';
import PublicView from './PublicView.jsx';

export default function App() {
  const [view, setView] = useState('authority');

  return <div className="app-shell">
    <aside className="sidebar" aria-label="RoadSense navigation">
      <a className="brand-lockup" href="#roadsense-home" aria-label="RoadSense home">
        <span className="brand-mark" aria-hidden="true"><span className="brand-road">R</span></span>
        <span className="brand-copy"><strong>RoadSense</strong><small>ROAD SAFETY</small></span>
      </a>
      <p className="role-label">MOCK ROLE SELECTOR</p>
      <nav className="nav-list" aria-label="Select view">
        <button type="button" className={view === 'authority' ? 'active' : ''} aria-pressed={view === 'authority'}
          onClick={() => setView('authority')}><ShieldCheck size={18} />Authority View</button>
        <button type="button" className={view === 'public' ? 'active' : ''} aria-pressed={view === 'public'}
          onClick={() => setView('public')}><MapPinned size={18} />Public View</button>
      </nav>
      <div className="sidebar-note"><strong>Prototype views</strong><span>Switching views does not create an account, authenticate a user, or change permissions.</span></div>
      <div className="sidebar-footer">LOCAL HACKATHON PROTOTYPE</div>
    </aside>

    <main className="workspace" id="roadsense-home">
      <header className="topbar">
        <div><p className="eyebrow">ROADSENSE</p><h1>{view === 'authority' ? 'Authority workspace' : 'Public information'}</h1></div>
        <span className="local-badge">LOCAL PROTOTYPE</span>
      </header>
      <section hidden={view !== 'authority'} aria-label="Authority View">
        <AuthorityView active={view === 'authority'} />
      </section>
      <section hidden={view !== 'public'} aria-label="Public View">
        <PublicView active={view === 'public'} />
      </section>
      <footer className="page-footer"><span>RoadSense · Local prototype</span><span>Candidate events require human review.</span></footer>
    </main>
  </div>;
}

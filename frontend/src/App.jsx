import React, { useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogOut, MapPin, ShieldCheck } from 'lucide-react';
import AuthorityView from './AuthorityView.jsx';
import PublicView from './PublicView.jsx';
import { AuthProvider, useAuth } from './auth.jsx';

function LoginPage({ role }) {
  const isAuthority = role === 'authority';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registering, setRegistering] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const { signIn, register } = useAuth();
  const navigate = useNavigate();

  const submit = async (event) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (registering && !name.trim()) {
      setError('Enter your name.');
      return;
    }
    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      if (registering) await register(name.trim(), email.trim(), password);
      else await signIn(role, email.trim(), password);
      navigate(isAuthority ? '/authority' : '/public', { replace: true });
    } catch (authError) {
      setError(authError.message || 'Could not authenticate. Check the API connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className={`login-page ${isAuthority ? 'login-authority' : 'login-public'}`}>
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">R</span><span><strong>RoadSense</strong><small>Road safety video review</small></span></div>
      <div className="login-heading">
        <span className="login-icon" aria-hidden="true">{isAuthority ? <ShieldCheck size={22} /> : <MapPin size={22} />}</span>
        <p className="eyebrow">{isAuthority ? 'AUTHORITY ACCESS' : 'PUBLIC ACCESS'}</p>
        <h1 id="login-title">{isAuthority ? 'Authority Portal' : 'Welcome to RoadSense'}</h1>
        <p>{isAuthority ? 'Sign in to review traffic-video analysis and candidate events.' : 'Explore confirmed road-safety hotspots and route demonstrations.'}</p>
      </div>
      <form className="login-form" onSubmit={submit} noValidate>
        {registering && <><label htmlFor="login-name">Name</label><input id="login-name" type="text" autoComplete="name" required maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setError(''); }} placeholder="Your name" /></>}
        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" autoComplete="email" required value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} placeholder="name@example.org" />
        <label htmlFor="login-password">Password</label>
        <div className="password-field">
          <input id="login-password" type={passwordVisible ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} placeholder={registering ? 'At least 8 characters' : 'Enter your password'} />
          <button type="button" className="password-toggle" aria-label={passwordVisible ? 'Hide password' : 'Show password'} onClick={() => setPasswordVisible((value) => !value)}>{passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
        </div>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="button button-primary login-submit" type="submit" disabled={submitting}>{submitting ? 'Please wait…' : registering ? 'Create public account' : 'Sign in'}</button>
      </form>
      {isAuthority && <p className="authorized-note"><ShieldCheck size={15} />Authorized personnel only</p>}
      <div className="prototype-note"><strong>{isAuthority ? 'Authority access must be assigned by the project administrator.' : 'Your account is protected by Supabase Auth.'}</strong><span>{isAuthority ? 'Public signups cannot enter this portal until an administrator changes that account’s role to authority in Supabase. Confirm the email first.' : 'Supabase manages password security and refreshes your sign-in session.'}</span></div>
      {!isAuthority && <p className="login-switch">{registering ? 'Already have a public account?' : 'New to RoadSense?'}{' '}<button className="text-link" type="button" onClick={() => { setRegistering((value) => !value); setError(''); }}>{registering ? 'Sign in' : 'Create an account'}</button></p>}
      <p className="login-switch">{isAuthority ? 'Visiting as a member of the public?' : 'Authority staff access?'}{' '}
        <Link to={isAuthority ? '/public/login' : '/authority/login'}>{isAuthority ? 'Public login' : 'Authority Portal'}</Link>
      </p>
    </section>
  </main>;
}

function RoleLoginRoute({ role }) {
  const { session, authReady } = useAuth();
  if (!authReady) return <main className="login-page"><p role="status">Checking your sign-in session…</p></main>;
  if (session) return <Navigate to={session.role === 'authority' ? '/authority' : '/public'} replace />;
  return <LoginPage role={role} />;
}

function RoleGuard({ role, children }) {
  const { session, authReady } = useAuth();
  const location = useLocation();
  if (!authReady) return <main className="login-page"><p role="status">Checking your sign-in session…</p></main>;
  if (!session) return <Navigate to={role === 'authority' ? '/authority/login' : '/public/login'} state={{ from: location }} replace />;
  if (session.role !== role) return <Navigate to={session.role === 'authority' ? '/authority' : '/public'} replace />;
  return children;
}

function WorkspaceLayout({ role, children }) {
  const isAuthority = role === 'authority';
  const { signOut, session } = useAuth();
  const navigate = useNavigate();
  const logout = () => {
    signOut();
    navigate(isAuthority ? '/authority/login' : '/public/login', { replace: true });
  };

  return <div className="workspace-shell">
    <header className="workspace-header">
      <Link className="workspace-brand" to={isAuthority ? '/authority' : '/public'} aria-label="RoadSense home">
        <span className="brand-mark" aria-hidden="true">R</span>
        <span><strong>RoadSense</strong><small>Road safety video review</small></span>
      </Link>
      <nav className="workspace-nav" aria-label={`${isAuthority ? 'Authority' : 'Public'} navigation`}>
        <Link to={isAuthority ? '/authority' : '/public'} aria-current="page">{isAuthority ? 'Authority workspace' : 'Public road safety'}</Link>
      </nav>
      <div className="workspace-session">
        <span className="role-indicator"><span className="status-pip" />{isAuthority ? 'Authority account' : 'Public account'}</span>
        <span className="session-email">{session.name || session.email}</span>
        <button className="button button-secondary logout-button" type="button" onClick={logout}><LogOut size={15} />Log out</button>
      </div>
    </header>
    <main className="workspace-main">{children}</main>
    <footer className="page-footer"><span>RoadSense · Prototype</span><span>Analysis outputs are screening candidates for human review.</span></footer>
  </div>;
}

function AppRoutes() {
  return <Routes>
    <Route path="/" element={<Navigate to="/public/login" replace />} />
    <Route path="/public/login" element={<RoleLoginRoute role="public" />} />
    <Route path="/authority/login" element={<RoleLoginRoute role="authority" />} />
    <Route path="/public/*" element={<RoleGuard role="public"><WorkspaceLayout role="public"><PublicView active /></WorkspaceLayout></RoleGuard>} />
    <Route path="/authority/*" element={<RoleGuard role="authority"><WorkspaceLayout role="authority"><AuthorityView active /></WorkspaceLayout></RoleGuard>} />
    <Route path="*" element={<Navigate to="/public/login" replace />} />
  </Routes>;
}

export default function App() {
  return <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>;
}

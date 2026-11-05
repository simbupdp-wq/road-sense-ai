import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, loginUser, logoutUser, refreshUserSession, registerPublicUser } from './api.js';

const SESSION_KEY = 'roadsense.supabase-session.v1';
const AuthContext = createContext(null);

function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!session?.accessToken || !session?.refreshToken || !['public', 'authority'].includes(session?.role) || !session?.email) return null;
    return session;
  } catch {
    return null;
  }
}

function makeSession(payload) {
  if (payload?.requires_email_confirmation) {
    throw new Error(payload.message || 'Confirm your email, then return here to sign in.');
  }
  if (!payload?.access_token || !payload?.refresh_token || !payload?.user?.role) {
    throw new Error('Supabase did not return a complete sign-in session. Check the email-confirmation setting and try again.');
  }
  return {
    ...payload.user,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
  };
}

function saveSession(nextSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  return nextSession;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let active = true;
    if (!session?.accessToken) {
      setAuthReady(true);
      return () => { active = false; };
    }

    const restore = async () => {
      try {
        let restored;
        if (session.expiresAt && session.expiresAt <= Date.now() + 60_000) {
          restored = makeSession(await refreshUserSession(session.refreshToken));
        } else {
          try {
            const { user } = await getCurrentUser(session.accessToken);
            restored = { ...session, ...user };
          } catch {
            restored = makeSession(await refreshUserSession(session.refreshToken));
          }
        }
        if (active) setSession(saveSession(restored));
      } catch {
        if (active) {
          sessionStorage.removeItem(SESSION_KEY);
          setSession(null);
        }
      } finally {
        if (active) setAuthReady(true);
      }
    };
    restore();
    return () => { active = false; };
  // Restore the persisted Supabase session once when the app starts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authReady || !session?.refreshToken || !session?.expiresAt) return undefined;
    const delay = Math.max(1000, session.expiresAt - Date.now() - 60_000);
    const timer = window.setTimeout(async () => {
      try {
        const nextSession = makeSession(await refreshUserSession(session.refreshToken));
        setSession(saveSession(nextSession));
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
        setSession(null);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [authReady, session?.refreshToken, session?.expiresAt]);

  const value = useMemo(() => ({
    session,
    authReady,
    async signIn(role, email, password) {
      const nextSession = makeSession(await loginUser({ role, email, password }));
      setSession(saveSession(nextSession));
      setAuthReady(true);
      return nextSession;
    },
    async register(name, email, password) {
      const payload = await registerPublicUser({ name, email, password });
      const nextSession = makeSession(payload);
      setSession(saveSession(nextSession));
      setAuthReady(true);
      return nextSession;
    },
    signOut() {
      const token = session?.accessToken;
      sessionStorage.removeItem(SESSION_KEY);
      setSession(null);
      setAuthReady(true);
      if (token) logoutUser(token).catch(() => {});
    },
  }), [session, authReady]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

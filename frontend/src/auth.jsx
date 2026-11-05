import React, { createContext, useContext, useMemo, useState } from 'react';

const SESSION_KEY = 'roadsense.prototype-session.v1';
const AuthContext = createContext(null);

function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return session?.role && session?.email ? session : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);
  const value = useMemo(() => ({
    session,
    signIn(role, email) {
      const nextSession = { role, email, prototypeOnly: true };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
    },
    signOut() {
      sessionStorage.removeItem(SESSION_KEY);
      setSession(null);
    },
  }), [session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

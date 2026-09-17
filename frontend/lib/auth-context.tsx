"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as cognito from "./cognito";
import type { Session } from "./cognito";
import type { Role } from "./types";

interface AuthState {
  session: Session | null;
  loading: boolean;
  role: Role | null;
  signIn: (email: string, password: string) => Promise<Session>;
  signUp: (email: string, password: string, givenName: string, familyName: string, role: Role) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function roleFromGroups(groups: string[]): Role | null {
  if (groups.includes("Doctors")) return "doctor";
  if (groups.includes("Patients")) return "patient";
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cognito
      .getCurrentSession()
      .then(setSession)
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const s = await cognito.signIn(email, password);
    setSession(s);
    return s;
  }, []);

  const signUp = useCallback(
    (email: string, password: string, givenName: string, familyName: string, role: Role) =>
      cognito.signUp(email, password, givenName, familyName, role),
    []
  );

  const confirmSignUp = useCallback((email: string, code: string) => cognito.confirmSignUp(email, code), []);

  const signOut = useCallback(() => {
    cognito.signOut();
    setSession(null);
  }, []);

  const role = session ? roleFromGroups(session.groups) : null;

  return (
    <AuthContext.Provider value={{ session, loading, role, signIn, signUp, confirmSignUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

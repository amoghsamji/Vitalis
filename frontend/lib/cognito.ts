import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
} from "amazon-cognito-identity-js";
import type { Role } from "./types";

const userPool = new CognitoUserPool({
  UserPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID as string,
  ClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID as string,
});

const hostedSessionKey = "vitalis.hosted-session";

export interface Session {
  idToken: string;
  sub: string;
  email: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  groups: string[];
}

function getUserAttributesMap(cognitoUser: CognitoUser): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    cognitoUser.getUserAttributes((err, attrs) => {
      if (err || !attrs) {
        resolve({});
        return;
      }
      const map: Record<string, string> = {};
      for (const attr of attrs) {
        map[attr.getName()] = attr.getValue();
      }
      resolve(map);
    });
  });
}

function sessionFromCognito(session: CognitoUserSession, extraAttrs?: Record<string, string>): Session {
  const idToken = session.getIdToken();
  const payload = idToken.decodePayload() as Record<string, unknown>;
  const email = String(payload["email"] ?? extraAttrs?.["email"] ?? "");

  const givenName = String(payload["given_name"] ?? payload["givenName"] ?? extraAttrs?.["given_name"] ?? "");
  const familyName = String(payload["family_name"] ?? payload["familyName"] ?? extraAttrs?.["family_name"] ?? "");
  const tokenName = String(payload["name"] ?? extraAttrs?.["name"] ?? "");

  let name = [givenName, familyName].filter(Boolean).join(" ") || tokenName;

  if (!name && typeof window !== "undefined" && email) {
    name = window.localStorage.getItem(`vitalis.user-name:${email.toLowerCase()}`) || "";
  }

  return {
    idToken: idToken.getJwtToken(),
    sub: String(payload["sub"] ?? ""),
    email,
    name: name || undefined,
    givenName: givenName || undefined,
    familyName: familyName || undefined,
    groups: (payload["cognito:groups"] as string[]) ?? [],
  };
}

/** Resolves the current session from a stored Cognito user, if any, refreshing tokens as needed. */
export function getCurrentSession(): Promise<Session | null> {
  const cognitoUser = userPool.getCurrentUser();
  if (!cognitoUser) return Promise.resolve(getHostedSession());

  return new Promise((resolve) => {
    cognitoUser.getSession(async (err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(getHostedSession());
        return;
      }
      const attrs = await getUserAttributesMap(cognitoUser);
      const s = sessionFromCognito(session, attrs);
      if (s.name && typeof window !== "undefined" && s.email) {
        window.localStorage.setItem(`vitalis.user-name:${s.email.toLowerCase()}`, s.name);
      }
      resolve(s);
    });
  });
}

function getHostedSession(): Session | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(hostedSessionKey);
  if (!stored) return null;

  try {
    const session = JSON.parse(stored) as Session & { expiresAt: number };
    if (session.expiresAt <= Date.now()) throw new Error("Session expired");
    return session;
  } catch {
    window.localStorage.removeItem(hostedSessionKey);
    return null;
  }
}

function sessionFromIdToken(idToken: string): (Session & { expiresAt: number }) | null {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as Record<string, unknown>;
    const expiresAt = Number(claims.exp) * 1000;
    if (!expiresAt || expiresAt <= Date.now()) return null;
    const email = String(claims.email ?? "");
    const given = String(claims.given_name ?? claims.givenName ?? "");
    const family = String(claims.family_name ?? claims.familyName ?? "");
    let name = [given, family].filter(Boolean).join(" ") || String(claims.name ?? "");
    if (!name && typeof window !== "undefined" && email) {
      name = window.localStorage.getItem(`vitalis.user-name:${email.toLowerCase()}`) || "";
    }
    return {
      idToken,
      sub: String(claims.sub ?? ""),
      email,
      name: name || undefined,
      givenName: given || undefined,
      familyName: family || undefined,
      groups: (claims["cognito:groups"] as string[]) ?? [],
      expiresAt,
    };
  } catch {
    return null;
  }
}

/** Starts Cognito Hosted UI, which offers password sign-in, sign-up, and Google. */
export function startHostedSignIn(): void {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  const redirectUri = process.env.NEXT_PUBLIC_OAUTH_REDIRECT_URI;
  if (!domain || !redirectUri) {
    throw new Error("Sign-in is not configured. Set NEXT_PUBLIC_COGNITO_DOMAIN and NEXT_PUBLIC_OAUTH_REDIRECT_URI.");
  }
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID as string,
    response_type: "token",
    scope: "openid email profile",
    redirect_uri: redirectUri,
  });
  window.location.assign(`https://${domain}/login?${params}`);
}

/** Stores the ID token returned by Cognito Hosted UI after its redirect. */
export function completeHostedSignIn(): Session | null {
  if (typeof window === "undefined") return null;
  const idToken = new URLSearchParams(window.location.hash.slice(1)).get("id_token");
  if (!idToken) return null;
  const session = sessionFromIdToken(idToken);
  if (session) window.localStorage.setItem(hostedSessionKey, JSON.stringify(session));
  return session;
}

export function signUp(
  email: string,
  password: string,
  givenName: string,
  familyName: string,
  role: Role
): Promise<void> {
  const attributes = [
    new CognitoUserAttribute({ Name: "email", Value: email }),
    new CognitoUserAttribute({ Name: "given_name", Value: givenName }),
    new CognitoUserAttribute({ Name: "family_name", Value: familyName }),
    new CognitoUserAttribute({ Name: "custom:role", Value: role }),
  ];
  if (typeof window !== "undefined") {
    const fullName = [givenName, familyName].filter(Boolean).join(" ");
    if (fullName) {
      window.localStorage.setItem(`vitalis.user-name:${email.toLowerCase()}`, fullName);
    }
  }
  return new Promise((resolve, reject) => {
    userPool.signUp(email, password, attributes, [], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    cognitoUser.confirmRegistration(code, true, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function signIn(email: string, password: string): Promise<Session> {
  const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: async (session) => {
        const attrs = await getUserAttributesMap(cognitoUser);
        const s = sessionFromCognito(session, attrs);
        if (s.name && typeof window !== "undefined" && s.email) {
          window.localStorage.setItem(`vitalis.user-name:${s.email.toLowerCase()}`, s.name);
        }
        resolve(s);
      },
      onFailure: (err) => reject(err),
    });
  });
}

export function signOut(): void {
  userPool.getCurrentUser()?.signOut();
  if (typeof window !== "undefined") window.localStorage.removeItem(hostedSessionKey);
}


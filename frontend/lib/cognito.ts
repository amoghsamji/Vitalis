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

export interface Session {
  idToken: string;
  sub: string;
  email: string;
  groups: string[];
}

function sessionFromCognito(session: CognitoUserSession): Session {
  const idToken = session.getIdToken();
  const payload = idToken.decodePayload() as Record<string, unknown>;
  return {
    idToken: idToken.getJwtToken(),
    sub: String(payload["sub"] ?? ""),
    email: String(payload["email"] ?? ""),
    groups: (payload["cognito:groups"] as string[]) ?? [],
  };
}

/** Resolves the current session from a stored Cognito user, if any, refreshing tokens as needed. */
export function getCurrentSession(): Promise<Session | null> {
  const cognitoUser = userPool.getCurrentUser();
  if (!cognitoUser) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(sessionFromCognito(session));
    });
  });
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
      onSuccess: (session) => resolve(sessionFromCognito(session)),
      onFailure: (err) => reject(err),
    });
  });
}

export function signOut(): void {
  userPool.getCurrentUser()?.signOut();
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getInitData } from "./telegram";

export interface SessionUser {
  id: string;
  householdId: string;
  householdName: string;
  telegramId: number;
  displayName: string;
}

interface AuthResponse {
  token: string;
  expiresAt: number;
  user: SessionUser;
  supabase: { url: string; anonKey: string };
}

export type AuthResult =
  | { status: "ok"; user: SessionUser; db: SupabaseClient }
  | { status: "not_allowed" }
  | { status: "no_telegram" }
  | { status: "error"; message: string };

let session: AuthResponse | undefined;

async function requestSession(initData: string): Promise<Response> {
  return fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  });
}

/** Returns a valid access token, refreshing it from the same initData shortly before expiry. */
export async function getAccessToken(): Promise<string> {
  if (session && session.expiresAt - Date.now() / 1000 > 60) return session.token;
  const response = await requestSession(getInitData());
  if (!response.ok) throw new Error(`Session refresh failed (${response.status}); reopen the app`);
  session = (await response.json()) as AuthResponse;
  return session.token;
}

export async function signIn(): Promise<AuthResult> {
  const initData = getInitData();
  if (!initData) return { status: "no_telegram" };

  let response: Response;
  try {
    response = await requestSession(initData);
  } catch {
    return { status: "error", message: "Can't reach the server. Check your connection." };
  }
  if (response.status === 403) return { status: "not_allowed" };
  if (response.status === 401) {
    return { status: "error", message: "Telegram login expired. Close and reopen the app." };
  }
  if (!response.ok) return { status: "error", message: `Server error (${response.status}).` };

  session = (await response.json()) as AuthResponse;
  const db = createClient(session.supabase.url, session.supabase.anonKey, {
    accessToken: getAccessToken,
  });
  return { status: "ok", user: session.user, db };
}

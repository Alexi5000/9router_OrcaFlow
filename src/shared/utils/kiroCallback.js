import { matchesOAuthState } from "./oauthCallback";

export async function exchangeKiroCallback(callbackUrl, pending, provider) {
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error("Invalid callback URL format");
  }
  const auth = pending.current;
  if (!auth || auth.provider !== provider || !matchesOAuthState({ state: url.searchParams.get("state") }, auth)) {
    throw new Error("Callback state does not match this login attempt. Start a new connection.");
  }
  const error = url.searchParams.get("error");
  if (error) throw new Error(url.searchParams.get("error_description") || error);
  const code = url.searchParams.get("code");
  if (!code) throw new Error("No authorization code found in URL");
  if (typeof auth.codeVerifier !== "string" || !auth.codeVerifier) throw new Error("Login attempt is incomplete. Start a new connection.");
  pending.current = null;
  const res = await fetch("/api/oauth/kiro/social-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, codeVerifier: auth.codeVerifier, provider }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

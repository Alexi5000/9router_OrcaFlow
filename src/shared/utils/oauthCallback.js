export function callbackTargetOrigins(origin) {
  const url = new URL(origin);
  const origins = [url.origin];
  if (["localhost", "127.0.0.1"].includes(url.hostname)) {
    url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.push(url.origin);
  }
  return origins;
}

export function matchesOAuthState(data, authData) {
  return typeof authData?.state === "string" && authData.state.length > 0 && data?.state === authData.state;
}

export function trustedOAuthMessage(event, authData, popup) {
  if (!popup || event.source !== popup || event.data?.type !== "oauth_callback") return false;
  try {
    return event.origin === new URL(authData.redirectUri).origin && matchesOAuthState(event.data.data, authData);
  } catch {
    return false;
  }
}

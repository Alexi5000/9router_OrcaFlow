export function getSessionSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret.includes("change-me") || secret.includes("default-secret")) {
    throw new Error("Configure JWT_SECRET with at least 32 random characters");
  }
  return new TextEncoder().encode(secret);
}

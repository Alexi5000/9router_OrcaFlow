import { NextResponse } from "next/server";
import { ProviderUrlError, validateProvider } from "@/lib/network/providerValidation";

// Parse error details for user-friendly messages
const getErrorMessage = (error) => {
  if (error.cause?.code === "ECONNREFUSED") return "Connection refused - provider node offline or unreachable";
  if (error.cause?.code === "ENOTFOUND") return "DNS lookup failed - invalid domain or network issue";
  if (error.cause?.code === "ETIMEDOUT") return "Connection timeout - provider node too slow";
  if (error.message.includes("timeout")) return "Request timeout (>10s) - provider node not responding";
  if (error.cause?.code === "CERT_HAS_EXPIRED") return "SSL certificate expired";
  if (error.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return "SSL certificate verification failed";
  if (error.cause?.code) return `Network error: ${error.cause.code}`;
  return "Network connection failed - check URL and network connectivity";
};

// POST /api/provider-nodes/validate - Validate API key against base URL
export async function POST(request) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, type } = body;

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: "Base URL and API key required" }, { status: 400 });
    }

    const valid = await validateProvider(baseUrl, apiKey, type);
    return NextResponse.json({ valid, error: valid ? null : "Invalid API key or unauthorized" });
  } catch (error) {
    if (error instanceof ProviderUrlError) {
      return NextResponse.json({ valid: false, error: error.message }, { status: 400 });
    }
    const errorMessage = getErrorMessage(error);
    console.error("Error validating provider node:", {
      message: error.message,
      cause: error.cause,
      code: error.cause?.code,
      userMessage: errorMessage
    });
    return NextResponse.json({
      valid: false,
      error: errorMessage
    }, { status: 500 });
  }
}

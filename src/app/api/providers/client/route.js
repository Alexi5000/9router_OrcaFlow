import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/providers/client - List all connections for client (includes sensitive fields for sync)
export async function GET() {
  try {
    const connections = await getProviderConnections();

    // Include sensitive fields for sync to cloud (only accessible from same origin)
    const clientConnections = connections.map((c) => ({
      ...c,
      // Don't hide sensitive fields here since this is for internal sync
    }));

    const response = NextResponse.json({ connections: clientConnections });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json(
      { error: "Failed to fetch providers" },
      { status: 500 },
    );
  }
}

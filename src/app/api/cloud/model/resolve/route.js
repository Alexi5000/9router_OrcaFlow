import { NextResponse } from "next/server";
import { validateApiKey, getCombos, getModelAliases } from "@/models";
import { resolveModelAliasFromMap } from "open-sse/services/model.js";

// Resolve model alias to provider/model
export async function POST(request) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing API key" }, { status: 401 });
    }

    const apiKey = authHeader.slice(7);

    const body = await request.json();
    const { alias } = body;

    if (!alias) {
      return NextResponse.json({ error: "Missing alias" }, { status: 400 });
    }

    // Validate API key
    const isValid = await validateApiKey(apiKey);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const [modelAliases, combos] = await Promise.all([
      getModelAliases(),
      getCombos(),
    ]);
    const resolved = resolveModelAliasFromMap(alias, modelAliases);

    if (resolved?.provider) {
      return NextResponse.json({
        alias,
        provider: resolved.provider,
        model: resolved.model,
      });
    }

    if (resolved?.model) {
      const combo = (combos || []).find((entry) => entry.name === resolved.model);
      if (combo) {
        return NextResponse.json({
          alias,
          provider: null,
          model: resolved.model,
          isCombo: true,
          models: combo.models || [],
        });
      }
    }

    // Not found
    return NextResponse.json({ error: "Alias not found" }, { status: 404 });

  } catch (error) {
    console.log("Model resolve error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

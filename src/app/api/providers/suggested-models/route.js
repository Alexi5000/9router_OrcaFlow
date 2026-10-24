import { NextResponse } from "next/server";
import { fetchPublic } from "@/shared/utils/ssrfGuard.js";
import { FILTERS } from "./filters.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const type = searchParams.get("type");

  if (!url || !type) {
    return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
  }

  const filter = FILTERS[type];
  if (!filter) {
    return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
  }

  try {
    const res = await fetchPublic(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return NextResponse.json({ data: [] });
    }
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    // Object-shaped catalogs (minimax-code's {providers:[…]}) ride in as a
    // single-element array so every filter keeps an array input contract.
    const data = filter(Array.isArray(raw) ? raw : typeof raw === "object" && raw !== null ? [raw] : []);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  }
}

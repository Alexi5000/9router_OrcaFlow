import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export async function GET() {
  try {
    const settings = await getSettings();
    const requireLogin = settings.requireLogin === true;
    return NextResponse.json({ requireLogin });
  } catch (error) {
    return NextResponse.json({ requireLogin: false }, { status: 200 });
  }
}

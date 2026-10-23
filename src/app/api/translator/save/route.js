import { NextResponse } from "next/server";
import fs from "@/lib/managedFiles";
import path from "path";

export async function POST(request) {
  try {
    const { file, content } = await request.json();

    if (!file || typeof content !== "string") {
      return NextResponse.json({ success: false, error: "File and content required" }, { status: 400 });
    }

    // Security: only allow specific filenames
    const allowedFiles = [
      "1_req_client.json",
      "2_req_source.json",
      "3_req_openai.json",
      "4_req_target.json",
      "5_res_provider.txt",
      "6_res_openai.txt",
      "7_res_client.txt",
      "7_res_client.json",
    ];

    if (!allowedFiles.includes(file)) {
      return NextResponse.json({ success: false, error: "Invalid file name" }, { status: 400 });
    }

    const logsDir = path.join(process.cwd(), "logs", "translator");
    

    const filePath = path.join(logsDir, file);
    fs.writeFile(filePath, content, "utf-8");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving file:", error);
    return NextResponse.json({ success: false, error: "Failed to save translator file" }, { status: 500 });
  }
}

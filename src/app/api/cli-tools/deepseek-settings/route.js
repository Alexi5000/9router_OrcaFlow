"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import {
  isLocalDeepSeekRouterUrl,
  normalizeDeepSeekCliApiUrl,
  normalizeDeepSeekCliBaseUrl,
  resolveDeepSeekCliConfigPath,
} from "@/shared/utils/deepseekCliConfig";

const execAsync = promisify(exec);

const checkDeepSeekInstalled = async () => {
  try {
    const isWindows = process.platform === "win32";
    const commands = isWindows
      ? ["where deepseek-cli", "where deepseek"]
      : ["command -v deepseek-cli", "command -v deepseek"];

    for (const command of commands) {
      try {
        await execAsync(command, { windowsHide: true });
        return true;
      } catch {
        // Try the next command.
      }
    }

    return false;
  } catch {
    return false;
  }
};

const readConfig = async () => {
  try {
    const configPath = resolveDeepSeekCliConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const has9RouterConfig = (config) => {
  const baseUrl = config?.baseUrl || config?.apiUrl || "";
  return isLocalDeepSeekRouterUrl(baseUrl);
};

export async function GET() {
  try {
    const isInstalled = await checkDeepSeekInstalled();

    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "DeepSeek CLI is not installed",
      });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: resolveDeepSeekCliConfigPath(),
    });
  } catch (error) {
    console.log("Error checking deepseek settings:", error);
    return NextResponse.json({ error: "Failed to check deepseek settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();

    if (typeof baseUrl !== "string" || !baseUrl.trim() ||
        typeof model !== "string" || !model.trim() ||
        (apiKey !== undefined && typeof apiKey !== "string")) {
      return NextResponse.json({ error: "baseUrl and model are required" }, { status: 400 });
    }

    let normalizedBaseUrl;
    try {
      normalizedBaseUrl = normalizeDeepSeekCliBaseUrl(baseUrl);
    } catch {
      return NextResponse.json({ error: "Invalid API URL" }, { status: 400 });
    }

    const configPath = resolveDeepSeekCliConfigPath();
    const configDir = path.dirname(configPath);
    await fs.mkdir(configDir, { recursive: true });

    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    if (!config || typeof config !== "object" || Array.isArray(config)) {
      return NextResponse.json({ error: "Existing DeepSeek configuration is invalid" }, { status: 409 });
    }
    const keyToUse = apiKey || "sk_9router";

    config.baseUrl = normalizedBaseUrl;
    config.apiUrl = normalizeDeepSeekCliApiUrl(normalizedBaseUrl);
    config.apiKey = keyToUse;
    config.model = model;

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return NextResponse.json({
      success: true,
      message: "DeepSeek CLI settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error updating deepseek settings:", error);
    return NextResponse.json({ error: "Failed to update deepseek settings" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = resolveDeepSeekCliConfigPath();

    let config = {};
    try {
      const existing = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(existing);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({ success: true, message: "No config file to reset" });
      }
      throw error;
    }

    delete config.baseUrl;
    delete config.apiUrl;
    delete config.apiKey;
    delete config.model;

    if (Object.keys(config).length === 0) {
      await fs.unlink(configPath);
    } else {
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    }

    return NextResponse.json({
      success: true,
      message: "DeepSeek CLI settings reset successfully!",
    });
  } catch (error) {
    console.log("Error resetting deepseek settings:", error);
    return NextResponse.json({ error: "Failed to reset deepseek settings" }, { status: 500 });
  }
}

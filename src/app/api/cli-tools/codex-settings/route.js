
import { parseTOML, stringifyTOML } from "confbox";
import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "@/lib/managedFiles";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

const getCodexDir = () => path.join(os.homedir(), ".codex");
const getCodexConfigPath = () => path.join(getCodexDir(), "config.toml");
const getCodexAuthPath = () => path.join(getCodexDir(), "auth.json");

const parseToml = content => parseTOML(content);
const toToml = parsed => stringifyTOML(parsed);

// Check if codex CLI is installed (via which/where or config file exists)
const checkCodexInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where codex" : "which codex";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getCodexConfigPath());
      return true;
    } catch {
      return false;
    }
  }
};

// Read current config.toml
const readConfig = async () => {
  try {
    const configPath = getCodexConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    return content;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// Check if config has 9Router settings
const has9RouterConfig = (config) => {
  if (!config) return false;
  return config.includes("model_provider = \"9router\"") || config.includes("[model_providers.9router]");
};

// GET - Check codex CLI and read current settings
export async function GET() {
  try {
    const isInstalled = await checkCodexInstalled();
    
    if (!isInstalled) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Codex CLI is not installed",
      });
    }

    const config = await readConfig();

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath: getCodexConfigPath(),
    });
  } catch (error) {
    console.log("Error checking codex settings:");
    return NextResponse.json({ error: "Failed to check codex settings" }, { status: 500 });
  }
}

// POST - Update 9Router settings (merge with existing config)
export async function POST(request) {
  try {
    const { baseUrl, apiKey, model, subagentModel } = await request.json();
    
    if (![baseUrl, apiKey, model].every(value => typeof value === "string" && value.trim())) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }

    const configPath = getCodexConfigPath();


    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parseToml(existingConfig);
    } catch (error) { if (error.code !== "ENOENT") throw error; }

    // Update only 9Router related fields (api_key goes to auth.json, not config.toml)
    parsed.model = model;
    parsed.model_provider = "9router";
    
    // Update or create 9router provider section (no api_key - Codex reads from auth.json)
    // Ensure /v1 suffix is added only once
    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    parsed.model_providers ??= {};
    parsed.model_providers["9router"] = {
      name: "9Router",
      base_url: normalizedBaseUrl,
      wire_api: "responses",
      http_headers: { Authorization: `Bearer ${apiKey}` },
    };

    // Subagent model is a scalar under [agents]; agents.<role> now means a custom role
    delete parsed.agents?.subagent;
    parsed.agents ??= {};
    parsed.agents.default_subagent_model = subagentModel || model;

    // Write merged config
    const configContent = toToml(parsed);
    // Update auth.json with OPENAI_API_KEY (Codex reads this first)
    const authPath = getCodexAuthPath();
    let authData = {};
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      authData = JSON.parse(existingAuth);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    
    if (!authData || typeof authData !== "object" || Array.isArray(authData)) throw new Error("Invalid Codex auth");
    authData.OPENAI_API_KEY = apiKey;
    await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
    await fs.writeFile(configPath, configContent);

    return NextResponse.json({
      success: true,
      message: "Codex settings applied successfully!",
      configPath,
    });
  } catch (error) {
    console.log("Error updating codex settings:");
    return NextResponse.json({ error: "Failed to update codex settings" }, { status: 500 });
  }
}

// DELETE - Remove 9Router settings only (keep other settings)
export async function DELETE() {
  try {
    const configPath = getCodexConfigPath();

    // Read and parse existing config
    let parsed = {};
    try {
      const existingConfig = await fs.readFile(configPath, "utf-8");
      parsed = parseToml(existingConfig);
    } catch (error) {
      if (error.code === "ENOENT") {
        return NextResponse.json({
          success: true,
          message: "No config file to reset",
        });
      }
      throw error;
    }

    // Remove 9Router related root fields only if they point to 9router
    if (parsed.model_provider === "9router") {
      delete parsed.model;
      delete parsed.model_provider;
    }
    
    // Remove 9router provider section
    if (parsed.model_providers) delete parsed.model_providers["9router"];

    // Remove subagent configuration (both the current key and the legacy role form)
    delete parsed.agents?.default_subagent_model;
    delete parsed.agents?.subagent;

    // Write updated config
    const configContent = toToml(parsed);
    await fs.writeFile(configPath, configContent);

    // Remove OPENAI_API_KEY from auth.json
    const authPath = getCodexAuthPath();
    try {
      const existingAuth = await fs.readFile(authPath, "utf-8");
      const authData = JSON.parse(existingAuth);
      if (!authData || typeof authData !== "object" || Array.isArray(authData)) throw new Error("Invalid Codex auth");
      delete authData.OPENAI_API_KEY;
      delete authData.auth_mode;
      
      // Write back or delete if empty
      if (Object.keys(authData).length === 0) {
        await fs.unlink(authPath);
      } else {
        await fs.writeFile(authPath, JSON.stringify(authData, null, 2));
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }

    return NextResponse.json({
      success: true,
      message: "9Router settings removed successfully",
    });
  } catch (error) {
    console.log("Error resetting codex settings:");
    return NextResponse.json({ error: "Failed to reset codex settings" }, { status: 500 });
  }
}

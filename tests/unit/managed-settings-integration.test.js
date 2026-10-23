import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const context = vi.hoisted(() => ({ root: "" }));
vi.mock("@/shared/utils/claudeConfig", () => ({ resolveClaudeSettingsPath: () => path.join(context.root, ".claude/settings.json") }));
vi.mock("@/shared/utils/deepseekCliConfig", async importOriginal => ({ ...(await importOriginal()), resolveDeepSeekCliConfigPath: () => path.join(context.root, ".deepseek-cli.json") }));
import { POST as claude } from "@/app/api/cli-tools/claude-settings/route.js";
import { POST as codex } from "@/app/api/cli-tools/codex-settings/route.js";
import { POST as copilot } from "@/app/api/cli-tools/copilot-settings/route.js";
import { POST as deepseek } from "@/app/api/cli-tools/deepseek-settings/route.js";
import { POST as opencode } from "@/app/api/cli-tools/opencode-settings/route.js";
import { POST as translator } from "@/app/api/translator/save/route.js";
const config = { baseUrl: "http://localhost:20128", model: "test-model", models: ["test-model"], apiKey: "private-test-key" };
const cases = [
  ["Claude", claude, ".claude/settings.json", { env: { ANTHROPIC_AUTH_TOKEN: "private-test-key" } }],
  ["Codex", codex, ".codex/config.toml", config],
  ["Copilot", copilot, ".config/Code/User/chatLanguageModels.json", config],
  ["DeepSeek", deepseek, ".deepseek-cli.json", config],
  ["OpenCode", opencode, ".config/opencode/opencode.json", config],
  ["translator", translator, "logs/translator/1_req_client.json", { file: "1_req_client.json", content: "private-test-content" }],
];
beforeEach(() => {
  context.root = fs.mkdtempSync(path.join(os.tmpdir(), "orcaflow-settings-"));
  vi.spyOn(os, "homedir").mockReturnValue(context.root);
  vi.spyOn(os, "platform").mockReturnValue("linux");
  vi.spyOn(process, "cwd").mockReturnValue(context.root);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(context.root, { recursive: true, force: true }); });
describe("management route file boundaries", () => {
  it.each(cases)("%s saves private output", async (_, handler, relative, body) => {
    expect((await handler({ json: async () => body })).status).toBe(200);
    const file = path.join(context.root, relative);
    expect(fs.statSync(file).isFile()).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
  it.each(cases)("%s rejects linked targets without modifying outside data", async (_, handler, relative, body) => {
    const outside = path.join(context.root, "outside"); fs.writeFileSync(outside, "outside-data");
    const file = path.join(context.root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.symlinkSync(outside, file);
    expect((await handler({ json: async () => body })).status).toBe(500);
    expect(fs.readFileSync(outside, "utf8")).toBe("outside-data");
  });
  it("preserves corrupt Copilot configuration", async () => {
    const file = path.join(context.root, ".config/Code/User/chatLanguageModels.json");
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "{broken");
    expect((await copilot({ json: async () => config })).status).toBe(500);
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  });
  it("rejects translator traversal and non-string output", async () => {
    for (const body of [{ file: "../outside", content: "no" }, { file: "1_req_client.json", content: {} }]) {
      expect((await translator({ json: async () => body })).status).toBe(400);
    }
    expect(fs.existsSync(path.join(context.root, "logs"))).toBe(false);
  });
  it("stores tunnel credentials privately and rejects redirected state", async () => {
    vi.resetModules();
    const { saveState, loadState } = await import("@/lib/tunnel/state.js");
    saveState({ apiKey: "tunnel-secret", tunnelUrl: "tunnel.test" });
    expect(loadState().apiKey).toBe("tunnel-secret");
    const file = path.join(context.root, ".9router/tunnel/state.json");
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.unlinkSync(file); const outside = path.join(context.root, "outside"); fs.writeFileSync(outside, "original"); fs.symlinkSync(outside, file);
    expect(() => saveState({ apiKey: "changed" })).toThrow();
    expect(fs.readFileSync(outside, "utf8")).toBe("original");
  });
});

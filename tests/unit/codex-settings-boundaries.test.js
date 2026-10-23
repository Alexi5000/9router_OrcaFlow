import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseTOML } from "confbox";
const io = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }));
vi.mock("@/lib/managedFiles", () => ({ default: io }));
import { POST, DELETE } from "@/app/api/cli-tools/codex-settings/route.js";
const post = changes => POST({ json: async () => ({ baseUrl: "http://localhost:20128", apiKey: "test-secret", model: "test-model", ...changes }) });
beforeEach(() => {
  vi.resetAllMocks();
  io.readFile.mockImplementation(() => { throw Object.assign(new Error("absent"), { code: "ENOENT" }); });
});
describe("Codex configuration updates", () => {
  it("encodes quotes/newlines as values and preserves existing TOML types", async () => {
    io.readFile.mockImplementation(file => file.endsWith(".toml") ? 'flag = true\ncount = 42\nitems = ["a", "b"]\n[model_providers.other]\nname = "other"\n' : '{"tokens":{"keep":true}}');
    const model = 'safe"\n[malicious]\nkey="bad';
    expect((await post({ model })).status).toBe(200);
    const config = parseTOML(io.writeFile.mock.calls.find(([file]) => file.endsWith(".toml"))[1]);
    expect(config).toMatchObject({ flag: true, count: 42, items: ["a", "b"], model, model_providers: { other: { name: "other" } } });
    expect(config.malicious).toBeUndefined();
    expect(JSON.parse(io.writeFile.mock.calls.find(([file]) => file.endsWith("auth.json"))[1]).tokens).toEqual({ keep: true });
  });
  it.each(["EACCES", "EIO"])("does not overwrite unreadable configuration: %s", async code => {
    io.readFile.mockImplementation(() => { throw Object.assign(new Error("unreadable"), { code }); });
    expect((await post()).status).toBe(500);
    expect(io.writeFile).not.toHaveBeenCalled();
  });
  it.each(['{"broken"', 'null', '[]', '42'])("rejects invalid auth before changing either file: %s", async value => {
    io.readFile.mockImplementation(file => file.endsWith(".toml") ? 'model = "old"' : value);
    expect((await post()).status).toBe(500);
    expect(io.writeFile).not.toHaveBeenCalled();
  });
  it("preserves malformed TOML instead of replacing it", async () => {
    io.readFile.mockReturnValue('broken = [');
    expect((await post()).status).toBe(500);
    expect(io.writeFile).not.toHaveBeenCalled();
  });
  it("reports auth reset write errors instead of success", async () => {
    io.readFile.mockImplementation(file => file.endsWith(".toml") ? 'model_provider = "9router"' : '{"OPENAI_API_KEY":"old","other":true}');
    io.writeFile.mockImplementation(file => { if (file.endsWith("auth.json")) throw new Error("disk failure"); });
    expect((await DELETE()).status).toBe(500);
  });
});

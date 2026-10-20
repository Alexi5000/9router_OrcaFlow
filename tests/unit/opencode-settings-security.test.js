import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(),
}));
vi.mock("fs/promises", () => ({ default: io }));
import { POST } from "@/app/api/cli-tools/opencode-settings/route.js";

const payload = { baseUrl: "http://localhost:20128", model: "provider/model" };
const post = (changes = {}) => POST({ json: async () => ({ ...payload, ...changes }) });

beforeEach(() => {
  vi.clearAllMocks();
  io.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
});

describe("OpenCode settings input and configuration preservation", () => {
  it.each(["__proto__", "constructor", "prototype", {}, [], 42, null, " "])(
    "rejects invalid model %j without writing", async model => {
      expect((await post({ model })).status).toBe(400);
      expect(io.writeFile).not.toHaveBeenCalled();
    },
  );

  it.each([{ baseUrl: {} }, { baseUrl: " " }, { apiKey: [] }])(
    "rejects malformed settings %j", async changes => {
      expect((await post(changes)).status).toBe(400);
      expect(io.writeFile).not.toHaveBeenCalled();
    },
  );

  it.each(["EACCES", "EIO"])("preserves unreadable configuration on %s", async code => {
    io.readFile.mockRejectedValue(Object.assign(new Error("unreadable"), { code }));
    expect((await post()).status).toBe(500);
    expect(io.writeFile).not.toHaveBeenCalled();
  });

  it.each(["{broken", "null", "[]", '{"provider":[]}', '{"provider":null}', '{"provider":42}'])(
    "preserves invalid existing configuration %s", async existing => {
      io.readFile.mockResolvedValue(existing);
      expect((await post()).status).toBeGreaterThanOrEqual(400);
      expect(io.writeFile).not.toHaveBeenCalled();
    },
  );

  it("creates a provider configuration when the file is absent", async () => {
    expect((await post()).status).toBe(200);
    const written = JSON.parse(io.writeFile.mock.calls[0][1]);
    expect(written.model).toBe("9router/provider/model");
    expect(written.provider["9router"].models).toEqual({ "provider/model": { name: "provider/model" } });
    expect(written.provider["9router"].options.baseURL).toBe("http://localhost:20128/v1");
  });

  it("retains unrelated providers and preferences during an update", async () => {
    io.readFile.mockResolvedValue(JSON.stringify({ theme: "dark", provider: { custom: { models: {} } } }));
    expect((await post()).status).toBe(200);
    const written = JSON.parse(io.writeFile.mock.calls[0][1]);
    expect(written.theme).toBe("dark");
    expect(written.provider.custom).toEqual({ models: {} });
  });
});

 it.each(["toString", "hasOwnProperty", "provider/model.with-dots"])("persists model %s as own JSON data", async model => {
    const request = new Request("http://localhost/api/opencode-settings", { method: "POST", body: JSON.stringify({ ...payload, model }) });
    expect((await POST(request)).status).toBe(200);
    const written = JSON.parse(io.writeFile.mock.calls[0][1]);
    expect(Object.hasOwn(written.provider["9router"].models, model)).toBe(true);
    expect(written.provider["9router"].models[model]).toEqual({ name: model });
    expect(written.model).toBe(`9router/${model}`);
  });

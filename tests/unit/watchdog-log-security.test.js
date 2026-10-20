import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../watchdog.mjs", import.meta.url), "utf8");
const start = source.indexOf("function trimRequestDetails() {");
const end = source.indexOf("// ── Main", start);
const body = source.slice(start, end);
let root;
let file;
let messages;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "orca-watchdog-"));
  file = path.join(root, "request-details.json");
  messages = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function trim(overrides = {}) {
  const context = { fs: { ...fs, ...overrides }, process, REQUEST_DETAILS_FILE: file, log: text => messages.push(text) };
  vm.runInNewContext(`${body}\ntrimRequestDetails();`, context, { timeout: 1000 });
}
function largeFile(target = file) {
  fs.writeFileSync(target, "preserve");
  fs.truncateSync(target, 51 * 1024 * 1024);
}

describe("watchdog request log trimming", () => {
  it("does not create missing logs", () => {
    trim();
    expect(fs.existsSync(file)).toBe(false);
    expect(messages).toEqual([]);
  });

  it("does not change logs below the threshold", () => {
    fs.writeFileSync(file, '[{"message":"keep"}]');
    trim();
    expect(fs.readFileSync(file, "utf8")).toBe('[{"message":"keep"}]');
    expect(messages).toEqual([]);
  });

  it("resets a large regular file and closes its descriptor", () => {
    largeFile();
    let closed = 0;
    trim({ closeSync(fd) { closed++; return fs.closeSync(fd); } });
    expect(fs.readFileSync(file, "utf8")).toBe("[]");
    expect(closed).toBe(1);
    expect(messages.at(-1)).toContain("trimmed to empty");
  });

  it("refuses symlinks without truncating the target", () => {
    const outside = path.join(root, "outside");
    largeFile(outside);
    fs.symlinkSync(outside, file);
    trim();
    expect(fs.statSync(outside).size).toBe(51 * 1024 * 1024);
    expect(messages.some(message => message.startsWith("Trim error:"))).toBe(true);
  });

  it("refuses hardlinks without truncating another name", () => {
    const outside = path.join(root, "outside");
    largeFile(outside);
    fs.linkSync(outside, file);
    trim();
    expect(fs.statSync(outside).size).toBe(51 * 1024 * 1024);
    expect(messages.some(message => message.startsWith("Trim error:"))).toBe(true);
  });

  it("a pathname replacement after validation cannot truncate the replacement", () => {
    largeFile();
    const retained = path.join(root, "retained");
    const replace = () => {
      fs.renameSync(file, retained);
      fs.writeFileSync(file, "replacement must survive");
    };
    trim({
      lstatSync(target) {
        const result = fs.lstatSync(target);
        replace();
        return result;
      },
      statSync(target) {
        const result = fs.statSync(target);
        replace();
        return result;
      },
    });
    expect(fs.readFileSync(file, "utf8")).toBe("replacement must survive");
    expect(fs.readFileSync(retained, "utf8")).toBe("[]");
  });

  it("write failures close the descriptor without truncating the file", () => {
    largeFile();
    let closed = 0;
    trim({ writeSync() { throw new Error("injected write failure"); }, closeSync(fd) { closed++; fs.closeSync(fd); } });
    expect(fs.statSync(file).size).toBe(51 * 1024 * 1024);
    expect(closed).toBe(1);
    expect(messages.at(-1)).toContain("injected write failure");
  });
  it("short writes do not truncate or report a successful reset", () => {
    largeFile();
    trim({ writeSync(fd) { return fs.writeSync(fd, "[", 0, "utf8"); } });
    expect(fs.statSync(file).size).toBe(51 * 1024 * 1024);
    expect(messages.at(-1)).toContain("Incomplete request log reset");
    expect(messages.some(message => message.includes("trimmed to empty"))).toBe(false);
  });

});

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

function resolveFile(file, create = false) {
  let target = path.resolve(file);
  const home = path.resolve(os.homedir());
  const relative = path.relative(home, target);
  if (relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) {
    target = path.join(fs.realpathSync(home), relative);
  }
  let directory = path.parse(target).root;
  for (const part of path.relative(directory, path.dirname(target)).split(path.sep).filter(Boolean)) {
    directory = path.join(directory, part);
    if (create) {
      try { fs.mkdirSync(directory, { mode: 0o700 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe managed directory");
    if (typeof process.getuid === "function") {
      const trustedOwner = stat.uid === process.getuid() || stat.uid === 0;
      const protectedSharedParent = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
      if (!trustedOwner || ((stat.mode & 0o022) !== 0 && !protectedSharedParent)) {
        throw new Error("Managed directory is writable by another user");
      }
    }
  }
  return target;
}

function checkFile(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("Unsafe managed file");
  }
}

function existingFile(target) {
  try { checkFile(fs.lstatSync(target)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

function readFile(file, encoding = "utf8") {
  const target = resolveFile(file);
  existingFile(target);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW || 0));
  try {
    checkFile(fs.fstatSync(fd));
    return fs.readFileSync(fd, encoding);
  } finally { fs.closeSync(fd); }
}

function writeFile(file, content) {
  const target = resolveFile(file, true);
  existingFile(target);
  const temporary = path.join(path.dirname(target), ".orcaflow-" + randomUUID());
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, content, "utf8");
    fs.closeSync(fd);
    fd = undefined;
    existingFile(target);
    fs.renameSync(temporary, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function unlink(file) {
  const target = resolveFile(file);
  existingFile(target);
  fs.unlinkSync(target);
}

function writeFileExclusive(file, content) {
  const target = resolveFile(file, true);
  let fd;
  try { fd = fs.openSync(target, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") return false; throw error; }
  try { fs.writeFileSync(fd, content); }
  finally { fs.closeSync(fd); }
  return true;
}

module.exports = { readFile, writeFile, writeFileExclusive, unlink };

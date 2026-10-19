const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { withPrivateTempDirectory } = require('../../src/mitm/privateTemp');

function loadDns(execFile) {
  const filename = path.resolve(__dirname, '../../src/mitm/dns/dnsConfig.js');
  const localRequire = createRequire(filename);
  const context = {
    module: { exports: {} }, process, console, setTimeout, clearTimeout,
    require(name) { return name === 'child_process' ? { execFile } : localRequire(name); },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

function commandPath(command) {
  const match = command.match(/'-File','"((?:''|[^"])+)"'/);
  assert.ok(match);
  return match[1].replace(/''/g, "'");
}

test('temporary scopes are unique, private, exclusive, and removed after return', async () => {
  const directories = [];
  await Promise.all([1, 2].map(() => withPrivateTempDirectory(async (temp) => {
    const file = temp.write('secret.ps1', 'private value');
    const directory = path.dirname(file);
    directories.push(directory);
    assert.equal(fs.readFileSync(file, 'utf8'), 'private value');
    assert.throws(() => temp.write('secret.ps1', 'overwrite'), { code: 'EEXIST' });
    assert.throws(() => temp.write('../escape.ps1', 'escape'), /Invalid temporary filename/);
    if (process.platform === 'win32') {
      const script = `$acl = Get-Acl -LiteralPath '${directory.replace(/'/g, "''")}'; [pscustomobject]@{Protected=$acl.AreAccessRulesProtected; Sids=@($acl.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value })} | ConvertTo-Json -Compress`;
      const acl = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }));
      assert.equal(acl.Protected, true);
      assert.equal(acl.Sids.length, 3);
      assert.ok(acl.Sids.includes('S-1-5-18'));
      assert.ok(acl.Sids.includes('S-1-5-32-544'));
      assert.ok(!acl.Sids.includes('S-1-1-0'));
    } else {
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  })));
  assert.equal(new Set(directories).size, 2);
  directories.forEach(directory => assert.equal(fs.existsSync(directory), false));
});

test('cleanup runs on callback and exclusive-write failure', async () => {
  let directory;
  await assert.rejects(withPrivateTempDirectory(async (temp) => {
    directory = path.dirname(temp.write('secret.ps1', 'secret'));
    temp.write('secret.ps1', 'bad');
  }), { code: 'EEXIST' });
  assert.equal(fs.existsSync(directory), false);
});

test('existing symlink cannot redirect exclusive file creation', { skip: process.platform === 'win32' }, async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-temp-target-'));
  const target = path.join(outside, 'target');
  fs.writeFileSync(target, 'unchanged');
  try {
    await withPrivateTempDirectory(async (temp) => {
      const dir = path.dirname(temp.write('anchor.tmp', ''));
      fs.symlinkSync(target, path.join(dir, 'command.ps1'));
      assert.throws(() => temp.write('command.ps1', 'overwrite'), { code: 'EEXIST' });
      assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
    });
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
});

test('elevation keeps script and auxiliary files private until completion then removes all', async () => {
  let directory;
  const dns = loadDns((executable, args, options, callback) => {
    assert.equal(executable, "powershell.exe");
    const command = args.at(-1);
    const scriptPath = commandPath(command);
    directory = path.dirname(scriptPath);
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(content.includes('ROUTER_API_KEY=test-secret'));
    assert.equal(fs.readFileSync(path.join(directory, 'hosts.tmp'), 'utf8'), '127.0.0.1 example');
    assert.equal(fs.readFileSync(path.join(directory, 'complete.flag'), 'utf8'), '');
    fs.writeFileSync(path.join(directory, 'complete.flag'), '\uFEFFdone\r\n');
    callback(null);
  });
  await dns.executeElevatedPowerShell(temp => {
    temp.write('hosts.tmp', '127.0.0.1 example');
    return 'ROUTER_API_KEY=test-secret';
  });
  assert.equal(fs.existsSync(directory), false);
});

for (const mode of ['timeout', 'failure']) {
  test(`elevation ${mode} rejects and removes scripts and data`, async () => {
    let directory;
    const dns = loadDns((executable, args, options, callback) => {
    assert.equal(executable, "powershell.exe");
    const command = args.at(-1);
      directory = path.dirname(commandPath(command));
      callback(mode === 'failure' ? new Error('command failure') : null);
    });
    await assert.rejects(dns.executeElevatedPowerShell('secret', 1), /Timed out|elevation failed/);
    assert.equal(fs.existsSync(directory), false);
  });
}

test('Windows ACL setup failure writes no secret and removes the empty directory', async () => {
  const filename = path.resolve(__dirname, '../../src/mitm/privateTemp.js');
  let directory;
  let writes = 0;
  const context = {
    module: { exports: {} }, process: { platform: 'win32' },
    require(name) {
      if (name === 'node:fs') return {
        ...fs,
        mkdtempSync(prefix) { directory = fs.mkdtempSync(prefix); return directory; },
        writeFileSync() { writes++; throw new Error('unexpected write'); },
      };
      if (name === 'node:child_process') return { execFileSync(command) {
        if (command === 'whoami.exe') return '"test","S-1-5-21-123-456-789-1001"';
        throw new Error('ACL denied');
      } };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  await assert.rejects(context.module.exports.withPrivateTempDirectory(temp => temp.write('secret.ps1', 'secret')), /ACL denied/);
  assert.equal(writes, 0);
  assert.equal(fs.existsSync(directory), false);
});


test('space-containing temp paths retain quoted PowerShell arguments', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca space test '));
  const saved = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR'].map(key => [key, process.env[key]]));
  try {
    for (const key of Object.keys(saved)) process.env[key] = root;
    const dns = loadDns((executable, args, options, callback) => {
      const command = args.at(-1);
      const scriptPath = commandPath(command);
      assert.ok(scriptPath.includes('orca space test '));
      if (process.platform === 'win32') {
        const commandWithoutElevation = command.replace(' -Verb RunAs', ' -Wait');
        execFileSync(executable, [...args.slice(0, -1), commandWithoutElevation], { windowsHide: true });
      } else {
        fs.writeFileSync(path.join(path.dirname(scriptPath), 'complete.flag'), 'done');
      }
      callback(null);
    });
    await dns.executeElevatedPowerShell('$null = 1');
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

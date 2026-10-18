const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'vendor/braces/integrity.json')));
const { existsSync } = require('node:fs');
if (existsSync(path.join(root, 'pnpm-lock.yaml'))) {
  const lock = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  assert.ok(lock.includes('braces@file:vendor/braces-3.0.3.tgz'));
  assert.ok(!/braces@[0-9]/.test(lock), 'Unpatched registry braces copy remains');
} else {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json')));
  const copies = Object.entries(lock.packages).filter(([location]) => location.endsWith('/braces'));
  assert.ok(copies.length > 0);
  for (const [location, metadata] of copies) {
    assert.equal(metadata.resolved, 'file:vendor/braces-3.0.3.tgz', `${location}: unexpected source`);
  }
}
const consumers = ['braces'];
try { require.resolve('micromatch'); consumers.push('micromatch'); } catch {}
for (const consumer of consumers) {
  const load = consumer === 'braces' ? require : createRequire(require.resolve(consumer));
  const entry = load.resolve('braces');
  const directory = path.dirname(entry);
  for (const [file, expected] of Object.entries(manifest)) {
    const actual = createHash('sha256').update(readFileSync(path.join(directory, file))).digest('hex');
    assert.equal(actual, expected, `${consumer}: unpatched ${file}`);
  }
  const braces = load('braces');
  assert.deepEqual(braces.expand('file-{a,b}-{1..2}'), ['file-a-1', 'file-a-2', 'file-b-1', 'file-b-2']);
  assert.equal(braces.stringify(braces.parse('{{a}}'), { escapeInvalid: true }), '{{a}}');
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    const pattern = (depth) => open.repeat(depth) + 'a,b' + close.repeat(depth);
    assert.doesNotThrow(() => braces.parse(pattern(100)));
    assert.throws(() => braces.parse(pattern(101)), SyntaxError);
    assert.throws(() => braces.parse(pattern(2), { maxDepth: 1.5 }), SyntaxError);
  }
  let ast = { type: 'text', value: 'x' };
  for (let depth = 0; depth < 102; depth++) ast = { type: 'brace', nodes: [ast] };
  ast = { type: 'root', nodes: [ast] };
  for (const method of ['compile', 'expand', 'stringify']) assert.throws(() => braces[method](ast), RangeError);
}
console.log('Braces backport integrity and security regressions passed.');

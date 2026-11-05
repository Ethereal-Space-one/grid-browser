// Independent launches, synthetic credentials, isolated profiles; no real keychain.
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const electron = require('electron');
const legacyBytes = Buffer.from('synthetic-legacy-encrypted-blob');
const secrets = ['synthetic-session-key-only', 'synthetic-env-primary-key', 'synthetic-env-alias-key'];
const env = { ...process.env };
for (const name of ['DEEPSEEK_API_KEY', 'DeepSeek_ApiKeyN', 'ELECTRON_RUN_AS_NODE']) delete env[name];
function scan(directory) {
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) scan(file);
    else for (const secret of secrets) assert.ok(!readFileSync(file).includes(Buffer.from(secret)), 'Synthetic credential was persisted');
  }
}
function phase(profile, mode, extra = {}) {
  const result = spawnSync(electron, [path.join(__dirname, 'e2e-key-session-worker.cjs'), profile, mode], {
    env: { ...env, ...extra }, encoding: 'utf8', timeout: 30000
  });
  if (result.status !== 0) throw new Error(mode + ' failed: ' + result.stdout + result.stderr);
  assert.ok(result.stdout.includes('"status":"passed"'));
  scan(profile);
  console.log(JSON.stringify({ phase: mode, status: 'passed' }));
}
const fresh = mkdtempSync(path.join(tmpdir(), 'grid-key-fresh-'));
phase(fresh, 'configure');
assert.equal(existsSync(path.join(fresh, 'provider-key.bin')), false);
phase(fresh, 'restart');
const legacy = mkdtempSync(path.join(tmpdir(), 'grid-key-legacy-'));
writeFileSync(path.join(legacy, 'provider-key.bin'), legacyBytes);
phase(legacy, 'configure');
phase(legacy, 'restart');
assert.deepEqual(readFileSync(path.join(legacy, 'provider-key.bin')), legacyBytes);
const environment = mkdtempSync(path.join(tmpdir(), 'grid-key-environment-'));
phase(environment, 'environment', { DEEPSEEK_API_KEY: secrets[1], DeepSeek_ApiKeyN: secrets[2] });
phase(environment, 'environment', { DeepSeek_ApiKeyN: secrets[2] });
console.log(JSON.stringify({ status: 'passed', launches: 6, keychainCalls: 0, legacyFileUnchanged: true, credentialPersistence: false }));

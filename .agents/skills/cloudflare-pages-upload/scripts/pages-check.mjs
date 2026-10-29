import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blake3, assetKey } from './blake3.mjs';
import { Pages, loadConfig, main } from './pages.mjs';

const fixture = '<!doctype html><html><body>template sample</body></html>';
const config = { accountId: 'a'.repeat(32), project: 's01e04-test',
  token: 'test-token-never-log', auditFile: '/unused/test.log' };
const project = { name: config.project, production_branch: 'main',
  subdomain: `${config.project}.pages.dev`, source: null,
  domains: [], canonical_deployment: { id: 'current-deployment' } };
const response = (result, status = 200) => new Response(JSON.stringify({
  success: status < 400, result, errors: status < 400 ? [] : [{ code: 10000, message: config.token }],
}), { status, headers: { 'Content-Type': 'application/json' } });

function mock(sequence) {
  const calls = [];
  const logs = [];
  const client = new Pages(config, {
    sleep: async () => {},
    log: async (record) => { logs.push(record); },
    request: async (url, options) => {
      calls.push({ url, ...options });
      assert.equal(options.redirect, 'error');
      assert.ok(sequence.length > 0, 'unexpected request');
      const next = sequence.shift();
      if (typeof next === 'function') return next(url, options);
      return next;
    },
  });
  return { client, calls, logs, sequence };
}

test('BLAKE3 matches every upstream unkeyed test vector (including chunk/tree boundaries)', async () => {
  const vectors = JSON.parse(await readFile(new URL('../references/blake3-vectors.json', import.meta.url), 'utf8'));
  for (const entry of vectors.cases) {
    const input = Buffer.from(Array.from({ length: entry.input_len }, (_, i) => i % 251));
    assert.equal(blake3(input).toString('hex'), entry.hash.slice(0, 64), `input length ${entry.input_len}`);
  }
  console.log(`BLAKE3 upstream vectors checked: ${vectors.cases.length}`);
});

test('Pages asset hash follows base64(contents) + html extension, truncated to 128 bits', () => {
  const bytes = Buffer.from(fixture);
  assert.equal(assetKey(bytes), blake3(Buffer.from(bytes.toString('base64') + 'html')).toString('hex').slice(0, 32));
  assert.equal(assetKey(bytes).length, 32);
});

test('put uploads only the single HTML, uses separate asset JWT, verifies stable URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pages-local-test-'));
  try {
    const path = join(dir, 'index.html');
    await writeFile(path, fixture);
    const key = assetKey(Buffer.from(fixture));
    const m = mock([
      response(project), response({ jwt: 'asset-jwt-never-log' }), response([key]),
      response(null), response(null), response({ id: 'new-deployment' }),
      response({ latest_stage: { status: 'active' } }),
      response({ latest_stage: { status: 'success' } }),
      new Response(fixture, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    ]);
    const result = await m.client.put(path);
    assert.deepEqual(result, { url: 'https://s01e04-test.pages.dev/', deployment: 'new-deployment', verified: true });
    assert.equal(m.sequence.length, 0);
    const upload = m.calls.find((c) => c.url.endsWith('/pages/assets/upload'));
    assert.equal(upload.headers.Authorization, 'Bearer asset-jwt-never-log');
    assert.deepEqual(JSON.parse(upload.body), [{
      key, value: Buffer.from(fixture).toString('base64'),
      metadata: { contentType: 'text/html; charset=utf-8' }, base64: true,
    }]);
    const deployment = m.calls.find((c) => c.url.endsWith('/deployments'));
    assert.deepEqual([...deployment.body.keys()], ['manifest', 'branch', '_headers']);
    assert.deepEqual(JSON.parse(deployment.body.get('manifest')), { '/index.html': key });
    assert.equal(deployment.body.get('branch'), 'main');
    assert.match(await deployment.body.get('_headers').text(), /Cache-Control: no-store/);
    assert.equal(deployment.headers.Authorization, `Bearer ${config.token}`);
    assert.equal(m.calls.at(-1).headers.Authorization, undefined);
    const serialized = JSON.stringify(m.logs);
    assert.ok(!serialized.includes(config.token));
    assert.ok(!serialized.includes('asset-jwt-never-log'));
    assert.ok(!serialized.includes(fixture));
    assert.ok(m.logs.some((l) => l.event === 'deployment-created'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cached asset skips upload but still creates and verifies replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pages-local-test-'));
  try {
    const path = join(dir, 'index.html');
    await writeFile(path, fixture);
    const m = mock([response(project), response({ jwt: 'jwt' }), response([]), response(null),
      response({ id: 'new-id' }), response({ latest_stage: { status: 'success' } }),
      new Response(fixture, { headers: { 'Content-Type': 'text/html' } })]);
    await m.client.put(path);
    assert.ok(!m.calls.some((c) => c.url.endsWith('/assets/upload')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('create has exactly the documented body; refuses an existing project', async () => {
  const m = mock([response(null, 404), response(project), response(project)]);
  await m.client.create();
  assert.deepEqual(JSON.parse(m.calls[1].body), { name: config.project, production_branch: 'main' });
  const existing = mock([response(project)]);
  await assert.rejects(existing.client.create(), /Project exists/);
  assert.equal(existing.calls.length, 1);
});

test('prune refuses current production before sending DELETE', async () => {
  const m = mock([response(project)]);
  await assert.rejects(m.client.prune('current-deployment'), /Refusing to delete current/);
  assert.equal(m.calls.length, 1);
});

test('prune deletes only selected old deployment and confirms API absence', async () => {
  const m = mock([response(project), response(null), response(null, 404)]);
  assert.deepEqual(await m.client.prune('old-deployment'), { removedDeployment: 'old-deployment' });
  assert.equal(m.calls[1].method, 'DELETE');
  assert.ok(m.calls[1].url.endsWith('/deployments/old-deployment'));
});

test('remove deletes only dedicated project and checks absence', async () => {
  const m = mock([response(project), response(null), response(null, 404)]);
  assert.deepEqual(await m.client.remove(), { removedProject: config.project });
  assert.equal(m.calls[1].method, 'DELETE');
  assert.equal(m.calls[1].url, `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/pages/projects/${config.project}`);
});

test('refuse Git-connected projects, other branches, custom domains and unexpected hostnames', async () => {
  for (const override of [{ source: { type: 'github' } }, { production_branch: 'master' },
    { domains: ['example.org'] }, { subdomain: 'another-project.pages.dev' }]) {
    const m = mock([response({ ...project, ...override })]);
    await assert.rejects(m.client.dedicatedProject(), /Refusing|Unexpected/);
    assert.equal(m.calls.length, 1);
  }
});

test('API errors and audits do not echo tokens or raw errors; no automatic retries', async () => {
  const m = mock([response(null, 403)]);
  await assert.rejects(m.client.project(), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.ok(!error.message.includes(config.token));
    return true;
  });
  assert.equal(m.calls.length, 1);
  assert.ok(!JSON.stringify(m.logs).includes(config.token));
});

test('network failure has a controlled error and one attempt', async () => {
  const m = mock([() => { throw new Error(config.token); }]);
  await assert.rejects(m.client.project(), /Network failure/);
  assert.equal(m.calls.length, 1);
  assert.ok(!JSON.stringify(m.logs).includes(config.token));
});

test('CLI refuses writes without explicit execute, before reading credentials', async () => {
  await assert.rejects(main(['put', '--file', '/unused', '--config', '/unused']), /--execute/);
  await assert.rejects(main(['remove', '--config', '/unused']), /--execute/);
  await assert.rejects(main(['put', '--execute', '--config', '/unused']), /requires --file/);
  await assert.rejects(main(['prune', '--execute', '--config', '/unused']), /requires --deployment/);
  await assert.rejects(main(['check', '--config', '/unused', '--file', '/unused']), /only valid/);
});

test('private credential config validation, token permissions, and no unknown fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pages-config-test-'));
  try {
    const tokenFile = join(dir, 'token');
    const auditFile = join(dir, 'audit');
    const cfgFile = join(dir, 'config.json');
    await writeFile(tokenFile, 'test-private-token', { mode: 0o600 });
    const cfg = { accountId: config.accountId, project: config.project, tokenFile, auditFile };
    await writeFile(cfgFile, JSON.stringify(cfg));
    assert.equal((await loadConfig(cfgFile)).token, 'test-private-token');
    await chmod(tokenFile, 0o644);
    await assert.rejects(loadConfig(cfgFile), /chmod 600/);
    await chmod(tokenFile, 0o600);
    await writeFile(cfgFile, JSON.stringify({ ...cfg, extra: true }));
    await assert.rejects(loadConfig(cfgFile), /exactly/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('reject scripts before asset upload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pages-local-test-'));
  try {
    const path = join(dir, 'index.html');
    await writeFile(path, '<html><script>alert(1)</script></html>');
    const m = mock([response(project)]);
    await assert.rejects(m.client.put(path), /no script/);
    assert.equal(m.calls.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

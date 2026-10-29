import { readFile, stat, appendFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assetKey } from './blake3.mjs';

const API = 'https://api.cloudflare.com/client/v4';
const HEADERS = '/*\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n';
const HELP = `No-install Pages uploader (Node 22+; only built-in modules).

node pages.mjs <command> --config /absolute/private/config.json [options]

Commands:
  check                Read the named project; never writes.
  create --execute     Create a dedicated Direct Upload project (production: main).
  put --file HTML --execute
                       Publish/replace exactly /index.html; verify stable URL.
  prune --deployment ID --execute
                       Delete one OLD deployment; refuses current production.
  remove --execute     DELETE THE DEDICATED PROJECT AND ALL ITS DEPLOYMENTS.
  --help               Show this contract and flags, without account access.

Config keys (no other keys accepted):
  accountId   32 lowercase hexadecimal characters; PERSONAL account only.
  project     Dedicated project name, lowercase letters/digits/hyphens, max 58.
  tokenFile   Absolute path to a mode-0600 file holding a Pages Edit API token.
  auditFile   Absolute PRIVATE path for redacted request/response summaries.

No token on argv or stdout. No automatic retries of writes. Network is restricted
to Cloudflare's API and the named project's pages.dev hostname. No directory
upload, Git integration, account creation, paid resources or package installation.
Each mutating command needs --execute AND the human's separate approval.
Do not run put again without approval to replace that public page.
`;

export async function loadConfig(path) {
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  if (!cfg || Array.isArray(cfg) || typeof cfg !== 'object') throw new Error('Config must be an object.');
  const expected = ['accountId', 'project', 'tokenFile', 'auditFile'];
  if (Object.keys(cfg).length !== expected.length || expected.some((k) => typeof cfg[k] !== 'string')) {
    throw new Error('Config requires exactly accountId, project, tokenFile and auditFile.');
  }
  if (!/^[a-f0-9]{32}$/.test(cfg.accountId)) throw new Error('Invalid accountId.');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(cfg.project)) throw new Error('Invalid project name.');
  for (const key of ['tokenFile', 'auditFile']) {
    if (!cfg[key].startsWith('/')) throw new Error(`${key} must be absolute.`);
  }
  if (cfg.tokenFile === cfg.auditFile || resolve(path) === cfg.auditFile) {
    throw new Error('Config, token and audit files must be different.');
  }
  const info = await stat(cfg.tokenFile);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('Token must be a private file (chmod 600).');
  const token = (await readFile(cfg.tokenFile, 'utf8')).trim();
  if (!token || /[\s\r\n]/.test(token)) throw new Error('Token file is empty or malformed.');
  return { ...cfg, token };
}

export class Pages {
  constructor(config, { request = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = (record) => appendFile(config.auditFile, JSON.stringify(record) + '\n', { mode: 0o600 }) } = {}) {
    this.config = config;
    this.request = request;
    this.sleep = sleep;
    this.log = log;
    this.base = `/accounts/${config.accountId}/pages/projects/${config.project}`;
  }

  async api(path, { method = 'GET', body, jwt, missingOK = false } = {}) {
    const headers = { Authorization: `Bearer ${jwt ?? this.config.token}` };
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    // Never log request payloads, token responses, raw errors, or HTML.
    await this.log({ at: new Date().toISOString(), event: 'request', method, path });
    let response;
    try {
      response = await this.request(API + path, { method, headers,
        body: body instanceof FormData || body === undefined ? body : JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout(45000) });
    } catch {
      await this.log({ event: 'response', method, path, error: 'network-or-timeout' });
      throw new Error(`Network failure on ${method}; inspect project before retrying a write.`);
    }
    let data;
    try { data = await response.json(); } catch { data = null; }
    await this.log({ event: 'response', method, path, status: response.status, success: data?.success === true });
    if (missingOK && response.status === 404) return null;
    if (!response.ok || data?.success !== true) {
      const codes = Array.isArray(data?.errors)
        ? data.errors.filter((e) => Number.isInteger(e?.code)).map((e) => e.code).join(',') : '';
      throw new Error(`Cloudflare ${method} failed (HTTP ${response.status}${codes ? `; codes ${codes}` : ''}). No automatic retry.`);
    }
    return data.result;
  }

  project(missingOK = false) {
    return this.api(this.base, { missingOK });
  }

  async dedicatedProject() {
    const p = await this.project();
    if (p?.name !== this.config.project || p?.production_branch !== 'main' || p?.source) {
      throw new Error('Refusing non-dedicated, Git-connected, or non-main project.');
    }
    if (p.subdomain !== `${this.config.project}.pages.dev`) throw new Error('Unexpected project hostname.');
    if (p.domains?.some((d) => d !== p.subdomain)) throw new Error('Refusing project with custom domains.');
    return p;
  }

  async create() {
    if (await this.project(true)) throw new Error('Project exists; inspect it with check. Nothing changed.');
    await this.api(`/accounts/${this.config.accountId}/pages/projects`, {
      method: 'POST', body: { name: this.config.project, production_branch: 'main' },
    });
    await this.dedicatedProject();
    return { created: true, project: this.config.project };
  }

  async put(filename) {
    // Deliberately do not create a project implicitly.
    const p = await this.dedicatedProject();
    const bytes = await readFile(filename);
    if (!bytes.length || bytes.length > 256 * 1024) throw new Error('Expected one HTML file, 1–262144 bytes.');
    const html = bytes.toString('utf8');
    if (!/<html(?:\s|>)/i.test(html) || /<script(?:\s|>)/i.test(html)) {
      throw new Error('Expected self-contained HTML with no script elements.');
    }
    const key = assetKey(bytes);
    const token = await this.api(`${this.base}/upload-token`);
    if (typeof token?.jwt !== 'string' || !token.jwt) throw new Error('Missing asset upload token.');
    const missing = await this.api('/pages/assets/check-missing', { method: 'POST', jwt: token.jwt,
      body: { hashes: [key] } });
    if (!Array.isArray(missing) || missing.some((k) => k !== key)) throw new Error('Unexpected missing-hashes response.');
    if (missing.includes(key)) {
      await this.api('/pages/assets/upload', { method: 'POST', jwt: token.jwt,
        body: [{ key, value: bytes.toString('base64'), metadata: { contentType: 'text/html; charset=utf-8' }, base64: true }] });
    }
    await this.api('/pages/assets/upsert-hashes', { method: 'POST', jwt: token.jwt, body: { hashes: [key] } });
    const form = new FormData();
    form.set('manifest', JSON.stringify({ '/index.html': key }));
    form.set('branch', 'main');
    form.set('_headers', new Blob([HEADERS], { type: 'text/plain' }), '_headers');
    const deployment = await this.api(`${this.base}/deployments`, { method: 'POST', body: form });
    if (!/^[a-zA-Z0-9-]+$/.test(deployment?.id ?? '')) throw new Error('Missing deployment ID; inspect project, do not repeat blindly.');
    // Persist the ID immediately: a later timeout must not lose the cleanup target.
    await this.log({ event: 'deployment-created', id: deployment.id, project: this.config.project });
    for (let i = 0; i < 30; i++) {
      const current = await this.api(`${this.base}/deployments/${deployment.id}`);
      const status = current?.latest_stage?.status;
      if (['failure', 'canceled'].includes(status)) throw new Error(`Deployment ${deployment.id} ${status}.`);
      if (status === 'success') {
        const url = `https://${p.subdomain}/`;
        for (let attempt = 0; attempt < 12; attempt++) {
          const res = await this.request(url, { redirect: 'error', headers: { 'Cache-Control': 'no-cache' },
            signal: AbortSignal.timeout(45000) });
          if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')
            && Buffer.from(await res.arrayBuffer()).equals(bytes)) {
            await this.log({ event: 'published-and-verified', id: deployment.id, url });
            return { url, deployment: deployment.id, verified: true };
          }
          await this.sleep(3000);
        }
        throw new Error(`Deployment ${deployment.id} succeeded but stable URL differs. Inspect before retrying.`);
      }
      await this.sleep(2000);
    }
    throw new Error(`Deployment ${deployment.id} still pending. Inspect before retrying.`);
  }

  async prune(id) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid deployment ID.');
    const p = await this.dedicatedProject();
    if (!p.canonical_deployment?.id) throw new Error('Cannot identify current production; refusing deletion.');
    if (p.canonical_deployment.id === id) throw new Error('Refusing to delete current production; replace it first.');
    await this.api(`${this.base}/deployments/${id}`, { method: 'DELETE' });
    const remaining = await this.api(`${this.base}/deployments/${id}`, { missingOK: true });
    if (remaining !== null) throw new Error('Old deployment is still accessible through the API.');
    return { removedDeployment: id };
  }

  async remove() {
    await this.dedicatedProject();
    await this.api(this.base, { method: 'DELETE' });
    if (await this.project(true)) throw new Error('Project still exists.');
    return { removedProject: this.config.project };
  }
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    config: { type: 'string' }, file: { type: 'string' }, deployment: { type: 'string' },
    execute: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command] = positionals;
  if (positionals.length !== 1 || !['check', 'create', 'put', 'prune', 'remove'].includes(command)) throw new Error('Unknown command; use --help.');
  if (!values.config) throw new Error('--config is required.');
  if (command !== 'check' && !values.execute) throw new Error('Write refused: --execute is required after human approval.');
  if (command === 'put' && !values.file) throw new Error('put requires --file.');
  if (command === 'prune' && !values.deployment) throw new Error('prune requires --deployment.');
  if (command !== 'put' && values.file) throw new Error('--file is only valid for put.');
  if (command !== 'prune' && values.deployment) throw new Error('--deployment is only valid for prune.');
  const client = new Pages(await loadConfig(values.config));
  let result;
  if (command === 'check') {
    const p = await client.dedicatedProject();
    result = { project: p.name, url: `https://${p.subdomain}/`, deployment: p.canonical_deployment?.id ?? null };
  } else if (command === 'put') result = await client.put(values.file);
  else if (command === 'prune') result = await client.prune(values.deployment);
  else result = await client[command]();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && process.argv[1] !== '-' && import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href) {
  main().catch((error) => {
    // A parser/config error could echo user input. Only expose our controlled errors.
    const message = error instanceof Error && error.constructor === Error ? error.message : 'Invalid input or local I/O failure; inspect configuration.';
    console.error(message);
    process.exitCode = 1;
  });
}

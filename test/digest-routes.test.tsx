import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';

describe('digest routes', () => {
  let tempRunsDir: string;
  const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: '' };

  beforeEach(() => {
    tempRunsDir = mkdtempSync(join(tmpdir(), 'digest-test-'));
    config.runsDir = tempRunsDir;
  });

  afterEach(() => {
    rmSync(tempRunsDir, { recursive: true, force: true });
  });

  describe('GET /digest/:night HTML', () => {
    it('returns 200 and valid HTML for a night with jobs', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'rig/rotate-logs', status: 'ok', owner: 'lane-07' }),
          JSON.stringify({ at: '2026-10-28T23:00:06+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Contains layout elements (no client JS per ADR 0001)
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('<html');
      expect(html).toContain('rig');
      expect(html).toContain('lane-07');
      expect(html).not.toContain('<script');

      // Contains digest table
      expect(html).toContain('<table');
      expect(html).toContain('job');
      expect(html).toContain('owner');
      expect(html).toContain('runs');
      expect(html).toContain('retries');
      expect(html).toContain('first');
      expect(html).toContain('last');
      expect(html).toContain('last error');

      // Contains job data in order
      expect(html).toContain('lane/sync');
      expect(html).toContain('rig/rotate-logs');
      expect(html).toContain('rook');
    });

    it('returns 404 for a night with no file', async () => {
      const res = await createApp(config).request('/digest/2026-10-30');
      expect(res.status).toBe(404);
    });

    it('displays "file not found" for missing night', async () => {
      const res = await createApp(config).request('/digest/2026-10-30');
      expect(res.status).toBe(404);
    });

    it('renders "nothing ran" for empty night file', async () => {
      writeFileSync(join(tempRunsDir, '2026-10-28.jsonl'), '');

      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('nothing ran');
    });

    it('renders "nothing ran" for night with only blank lines', async () => {
      writeFileSync(join(tempRunsDir, '2026-10-28.jsonl'), '\n\n  \n');

      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('nothing ran');
    });

    it('counts bad JSON lines and displays them', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'rig/rotate-logs', status: 'ok', owner: 'lane-07' }),
          'not valid json',
          JSON.stringify({ at: '2026-10-28T23:00:06+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('1 bad line');
      expect(html).toContain('rig/rotate-logs');
    });

    it('handles multiple bad lines', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'job-1', status: 'ok', owner: 'rook' }),
          'bad',
          'lines',
          JSON.stringify({ at: '2026-10-28T23:00:06+01:00', job: 'job-2', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('2 bad lines');
    });

    it('marks jobs with retries >= 3 or failures as warn', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'good-job', status: 'ok', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'retry-job', status: 'retry', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:02:00+01:00', job: 'retry-job', status: 'retry', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:03:00+01:00', job: 'retry-job', status: 'retry', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:04:00+01:00', job: 'fail-job', status: 'fail', owner: 'rook', error: 'crashed' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Good job row should not have warn class
      const goodJobRow = html.match(/<tr[^>]*>[\s\S]*?good-job[\s\S]*?<\/tr>/);
      expect(goodJobRow?.[0]).not.toContain('class="warn"');
      expect(goodJobRow?.[0]).not.toContain('class=\'warn\'');

      // Retry and fail job rows should have warn class
      expect(html).toMatch(/<tr[^>]*class="warn"[^>]*>[\s\S]*?retry-job[\s\S]*?<\/tr>/);
      expect(html).toMatch(/<tr[^>]*class="warn"[^>]*>[\s\S]*?fail-job[\s\S]*?<\/tr>/);
    });

    it('displays null owner as "—"', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'auto-job', status: 'ok', owner: null }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('—');
      expect(html).toContain('auto-job');
    });

    it('preserves offsets in timestamps (firstAt and lastAt from log)', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'job-1', status: 'retry', owner: 'rook', error: 'first error' }),
          JSON.stringify({ at: '2026-10-28T01:05:00+01:00', job: 'job-1', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();
      // Should show the original first timestamp with its offset
      expect(html).toContain('2026-10-28T01:00:00+01:00');
      // Should show the final last timestamp
      expect(html).toContain('2026-10-28T01:05:00+01:00');
    });

    it('includes lane banner with marker if set', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'job-1', status: 'ok', owner: 'rook' }),
      );

      process.env.LANE_MARKER = 'TEST-MARKER';
      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('TEST-MARKER');
      expect(html).toContain('rig');
    });

    it('rejects invalid night date format', async () => {
      const res = await createApp(config).request('/digest/invalid-date');
      expect(res.status).toBe(404);
    });

    it('maintains job sort order (case-sensitive code-unit)', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'zebra/job', status: 'ok', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'apple/job', status: 'ok', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:02:00+01:00', job: 'banana/job', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      const html = await res.text();

      const appleIdx = html.indexOf('apple/job');
      const bananaIdx = html.indexOf('banana/job');
      const zebraIdx = html.indexOf('zebra/job');
      expect(appleIdx).toBeLessThan(bananaIdx);
      expect(bananaIdx).toBeLessThan(zebraIdx);
    });
  });

  describe('GET /api/digest/:night JSON', () => {
    it('returns 200 and valid JSON for a night with jobs', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'rig/rotate-logs', status: 'ok', owner: 'lane-07' }),
          JSON.stringify({ at: '2026-10-28T23:00:06+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/api/digest/2026-10-28');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const json = await res.json() as any;
      expect(json).toHaveProperty('missing');
      expect(json).toHaveProperty('rows');
      expect(json).toHaveProperty('badLines');
      expect(json).toHaveProperty('counts');
      expect(json.missing).toBe(false);
      expect(Array.isArray(json.rows)).toBe(true);
    });

    it('returns 404 for a night with no file', async () => {
      const res = await createApp(config).request('/api/digest/2026-10-30');
      expect(res.status).toBe(404);
    });

    it('returns complete DigestResult structure', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'job-1', status: 'ok', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T23:00:06+01:00', job: 'job-2', status: 'retry', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T23:00:07+01:00', job: 'job-2', status: 'fail', owner: 'rook', error: 'oops' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/api/digest/2026-10-28');
      expect(res.status).toBe(200);
      const json = await res.json() as any;

      expect(json.missing).toBe(false);
      expect(json.badLines).toBe(0);
      expect(json.counts).toEqual({ ok: 1, retry: 1, fail: 1 });
      expect(json.rows).toHaveLength(2);
    });

    it('includes all DigestRow fields', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'test-job', status: 'retry', owner: 'rook', error: 'first error' }),
          JSON.stringify({ at: '2026-10-28T01:05:00+01:00', job: 'test-job', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/api/digest/2026-10-28');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      const row = json.rows[0];

      expect(row).toHaveProperty('job');
      expect(row).toHaveProperty('owner');
      expect(row).toHaveProperty('runs');
      expect(row).toHaveProperty('retries');
      expect(row).toHaveProperty('hasFailure');
      expect(row).toHaveProperty('lastStatus');
      expect(row).toHaveProperty('lastError');
      expect(row).toHaveProperty('firstAt');
      expect(row).toHaveProperty('lastAt');

      expect(row.job).toBe('test-job');
      expect(row.owner).toBe('rook');
      expect(row.runs).toBe(2);
      expect(row.retries).toBe(1);
      expect(row.hasFailure).toBe(false);
      expect(row.lastStatus).toBe('ok');
      expect(row.lastError).toBe(null);
      expect(row.firstAt).toBe('2026-10-28T01:00:00+01:00');
      expect(row.lastAt).toBe('2026-10-28T01:05:00+01:00');
    });

    it('returns same rows in same order as HTML', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'zebra', status: 'ok', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'apple', status: 'ok', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:02:00+01:00', job: 'banana', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const htmlRes = await createApp(config).request('/digest/2026-10-28');
      const jsonRes = await createApp(config).request('/api/digest/2026-10-28');
      const json = await jsonRes.json() as any;
      const html = await htmlRes.text();

      // Jobs should be in same sorted order
      expect(json.rows[0].job).toBe('apple');
      expect(json.rows[1].job).toBe('banana');
      expect(json.rows[2].job).toBe('zebra');

      // HTML should reflect same order
      const appleIdx = html.indexOf('apple');
      const bananaIdx = html.indexOf('banana');
      const zebraIdx = html.indexOf('zebra');
      expect(appleIdx).toBeLessThan(bananaIdx);
      expect(bananaIdx).toBeLessThan(zebraIdx);
    });

    it('handles null owner in JSON', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'auto-job', status: 'ok', owner: null }),
      );

      const res = await createApp(config).request('/api/digest/2026-10-28');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.rows[0].owner).toBe(null);
    });

    it('counts all valid events for counts, not just last status per job', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'job-1', status: 'retry', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'job-1', status: 'retry', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:02:00+01:00', job: 'job-1', status: 'ok', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:03:00+01:00', job: 'job-2', status: 'fail', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/api/digest/2026-10-28');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      // 2 retries + 1 ok + 1 fail = 2 ok, 2 retry, 1 fail
      expect(json.counts).toEqual({ ok: 2, retry: 2, fail: 1 });
    });

    it('handles empty night file', async () => {
      writeFileSync(join(tempRunsDir, '2026-10-28.jsonl'), '');

      const res = await createApp(config).request('/api/digest/2026-10-28');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.missing).toBe(false);
      expect(json.rows).toHaveLength(0);
      expect(json.badLines).toBe(0);
    });

    it('counts bad lines in JSON response', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job: 'job-1', status: 'ok', owner: 'rook' }),
          'invalid json line',
          JSON.stringify({ at: '2026-10-28T23:00:06+01:00', job: 'job-2', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/api/digest/2026-10-28');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.badLines).toBe(1);
    });

    it('rejects invalid night date format', async () => {
      const res = await createApp(config).request('/api/digest/not-a-date');
      expect(res.status).toBe(404);
    });

    it('tracks retries correctly across multiple events', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'job-1', status: 'retry', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'job-1', status: 'retry', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:02:00+01:00', job: 'job-1', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/api/digest/2026-10-28');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      const row = json.rows[0];
      expect(row.retries).toBe(2);
      expect(row.runs).toBe(3);
      expect(row.lastStatus).toBe('ok');
    });

    it('marks hasFailure true if any event failed, even if recovered', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'job-1', status: 'fail', owner: 'rook', error: 'oops' }),
          JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'job-1', status: 'ok', owner: 'rook' }),
        ].join('\n'),
      );

      const res = await createApp(config).request('/api/digest/2026-10-28');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      const row = json.rows[0];
      expect(row.hasFailure).toBe(true);
      expect(row.lastStatus).toBe('ok');
    });
  });

  describe('consistency between HTML and JSON', () => {
    it('HTML and JSON report same counts', async () => {
      writeFileSync(
        join(tempRunsDir, '2026-10-28.jsonl'),
        [
          JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'job-1', status: 'ok', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'job-2', status: 'retry', owner: 'rook' }),
          JSON.stringify({ at: '2026-10-28T01:02:00+01:00', job: 'job-3', status: 'fail', owner: 'rook' }),
        ].join('\n'),
      );

      const htmlRes = await createApp(config).request('/digest/2026-10-28');
      const jsonRes = await createApp(config).request('/api/digest/2026-10-28');
      const json = await jsonRes.json() as any;
      const html = await htmlRes.text();

      // JSON counts
      expect(json.counts.ok).toBe(1);
      expect(json.counts.retry).toBe(1);
      expect(json.counts.fail).toBe(1);

      // All 3 jobs should appear in HTML
      expect(html).toContain('job-1');
      expect(html).toContain('job-2');
      expect(html).toContain('job-3');
    });

    it('HTML and JSON both show same missing behavior', async () => {
      const htmlRes = await createApp(config).request('/digest/2026-10-31');
      const jsonRes = await createApp(config).request('/api/digest/2026-10-31');

      expect(htmlRes.status).toBe(404);
      expect(jsonRes.status).toBe(404);
    });
  });
});

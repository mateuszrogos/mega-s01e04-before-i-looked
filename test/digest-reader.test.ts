import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';
import type { DigestResult, ReadNight } from '../src/digest/types.js';

const night = '2026-10-28';
const at = '2026-10-29T01:30:00+01:00';
const event = (changes: Record<string, unknown> = {}) => ({
  at, job: 'job', status: 'ok', owner: 'rook', ...changes,
});
const empty: DigestResult = {
  missing: false, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
};

describe('readNight', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
  });
  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeEvents(events: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
  }

  it('satisfies the shared callable contract', () => {
    const reader: ReadNight = readNight;
    expect(reader(runsDir, night)).toEqual({ ...empty, missing: true });
  });

  it('reads the real fixture: five sorted jobs, one bad line, and all event counts', () => {
    const fixtureDir = new URL('../runs/', import.meta.url);
    const before = readFileSync(new URL(`${night}.jsonl`, fixtureDir), 'utf8');
    const result = readNight(fileURLToPath(fixtureDir), night);
    expect(result.missing).toBe(false);
    expect(result.badLines).toBe(1);
    expect(result.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result.rows).toEqual([
      {
        job: 'digest/render', owner: null, runs: 1, retries: 0, hasFailure: false,
        lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
      },
      {
        job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, hasFailure: false,
        lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
      },
      {
        job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, hasFailure: false,
        lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
      },
      {
        job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, hasFailure: true,
        lastStatus: 'fail', lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
      },
      {
        job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, hasFailure: false,
        lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
      },
    ]);
    expect(readFileSync(new URL(`${night}.jsonl`, fixtureDir), 'utf8')).toBe(before);
  });

  it('orders by instant rather than line order or offset spelling and retains recovered failures', () => {
    writeEvents([
      event({ at: '2026-10-29T01:15:00-01:00', owner: null }),
      event({ at: '2026-10-29T02:30:00+02:00', status: 'fail', error: 'old failure' }),
      event({ at: '2026-10-29T02:00:00+01:00', status: 'retry', error: 'retrying' }),
    ]);
    expect(readNight(runsDir, night)).toEqual({
      missing: false, badLines: 0, counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{
        job: 'job', owner: null, runs: 3, retries: 1, hasFailure: true,
        lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T02:30:00+02:00', lastAt: '2026-10-29T01:15:00-01:00',
      }],
    });
  });

  it('uses the last line for tied last events, preserving the first tied timestamp', () => {
    writeEvents([
      event({ at: '2026-10-29T00:30:00Z', status: 'fail', error: 'failed' }),
      event({ owner: null, error: null }),
    ]);
    expect(readNight(runsDir, night).rows[0]).toEqual({
      job: 'job', owner: null, runs: 2, retries: 0, hasFailure: true,
      lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T00:30:00Z', lastAt: at,
    });
  });

  it('counts invalid JSON and shapes without throwing or contaminating valid counts', () => {
    const invalid: unknown[] = [
      null, [], 'text', 12, true, {},
      event({ job: '' }), event({ job: ' \t' }), event({ job: 1 }),
      event({ status: 'pending' }), event({ status: null }),
      event({ owner: undefined }), event({ owner: {} }),
      event({ error: 4 }), event({ error: {} }),
      event({ at: null }), event({ at: 'yesterday' }),
      event({ at: '2026-10-29T01:00:00' }),
      event({ at: '2026-02-30T01:00:00Z' }),
      event({ at: '2026-10-29T24:00:00Z' }),
      event({ at: '2026-10-29T01:00:00+25:00' }),
      event({ at: '2026-10-29T01:00:00+01:99' }),
      event({ at: '2026-10-29T01:60:00Z' }),
      event({ at: '2026-10-29T01:00:60Z' }),
    ];
    writeEvents([...invalid, event({ extra: 'ignored', owner: null })]);
    const file = join(runsDir, `${night}.jsonl`);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n{"truncated":\n \t\n`);
    const result = readNight(runsDir, night);
    expect(result.badLines).toBe(invalid.length + 1);
    expect(result.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].owner).toBeNull();
  });

  it('distinguishes missing files and directories from empty and blank-only files', () => {
    expect(readNight(runsDir, night)).toEqual({ ...empty, missing: true });
    expect(readNight(join(runsDir, 'missing'), night)).toEqual({ ...empty, missing: true });
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual(empty);
    writeFileSync(join(runsDir, `${night}.jsonl`), '\r\n \t\r\n\n');
    expect(readNight(runsDir, night)).toEqual(empty);
  });

  it('supports CRLF, a final line without newline, and fractional timestamps', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      JSON.stringify(event({ at: '2026-10-29T01:00:00.123+01:00' })),
      '',
      JSON.stringify(event({ at: '2026-10-29T01:01:00Z', status: 'fail', error: 'last error' })),
    ].join('\r\n'));
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: 0, counts: { ok: 1, retry: 0, fail: 1 },
      rows: [{ runs: 2, lastStatus: 'fail', lastError: 'last error', hasFailure: true }],
    });
  });

  it('sorts jobs by code units and safely groups prototype-like names', () => {
    writeEvents(['z', '__proto__', 'a', 'A', 'constructor'].map((job) => event({ job })));
    expect(readNight(runsDir, night).rows.map((row) => row.job))
      .toEqual(['A', '__proto__', 'a', 'constructor', 'z']);
  });

  it.each([
    '', '..', '../2026-10-28', '/2026-10-28', '2026-10-28/../2026-10-27',
    '..\\2026-10-28', '2026-10-28.jsonl', '2026-10-28\0', '2026-10-28\n',
    '2026-2-03', '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01',
    '2026-10-00', '2026-10-32', '%2e%2e%2f2026-10-28',
  ])('rejects unsafe or invalid night %j before reading', (invalid) => {
    expect(() => readNight(runsDir, invalid)).toThrow(RangeError);
  });

  it('accepts a leap-day night', () => {
    writeFileSync(join(runsDir, '2024-02-29.jsonl'), '');
    expect(readNight(runsDir, '2024-02-29')).toEqual(empty);
  });

  it('propagates non-ENOENT I/O errors', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });

  it('returns independent results on repeated calls', () => {
    writeEvents([event()]);
    const first = readNight(runsDir, night);
    first.rows[0].runs = 99;
    first.counts.ok = 99;
    expect(readNight(runsDir, night)).toMatchObject({
      rows: [{ runs: 1 }], counts: { ok: 1, retry: 0, fail: 0 },
    });
  });
});

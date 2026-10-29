import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string | null;
};

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return match !== null && isNight(match[1]) && Number.isFinite(Date.parse(value));
}

function isEvent(value: unknown): value is RunEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return isTimestamp(event.at)
    && typeof event.job === 'string' && event.job.trim().length > 0
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (typeof event.owner === 'string' || event.owner === null)
    && (event.error === undefined || event.error === null || typeof event.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) throw new RangeError('night must be a real YYYY-MM-DD date');

  const result = {
    missing: false,
    rows: [] as DigestRow[],
    badLines: 0,
    counts: { ok: 0, retry: 0, fail: 0 },
  };
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      result.missing = true;
      return result;
    }
    throw error;
  }

  const jobs = new Map<string, { row: DigestRow; first: number; last: number; lastErrorAt: number }>();
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      result.badLines++;
      continue;
    }
    if (!isEvent(event)) {
      result.badLines++;
      continue;
    }

    result.counts[event.status]++;
    const at = Date.parse(event.at);
    const existing = jobs.get(event.job);
    if (!existing) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          hasFailure: event.status === 'fail',
          lastStatus: event.status,
          lastError: event.error ?? null,
          firstAt: event.at,
          lastAt: event.at,
        },
        first: at,
        last: at,
        lastErrorAt: event.error == null ? -Infinity : at,
      });
      continue;
    }

    const { row } = existing;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hasFailure = true;
    if (event.error != null && at >= existing.lastErrorAt) {
      existing.lastErrorAt = at;
      row.lastError = event.error;
    }
    if (at < existing.first) {
      existing.first = at;
      row.firstAt = event.at;
    }
    if (at >= existing.last) {
      existing.last = at;
      row.owner = event.owner;
      row.lastStatus = event.status;
      row.lastAt = event.at;
    }
  }

  result.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return result;
};

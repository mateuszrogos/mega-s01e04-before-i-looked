export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  /** Owner on the chronologically last event, including explicit null. */
  owner: string | null;
  /** All valid events for this job, including retries and failures. */
  runs: number;
  retries: number;
  /** True if any event failed, even if the job later recovered. */
  hasFailure: boolean;
  lastStatus: DigestStatus;
  /** Most recent non-null error by event instant; null if no event had an error. */
  lastError: string | null;
  /** Earliest/latest instants, with their original log offsets preserved. */
  firstAt: string;
  lastAt: string;
};

export type DigestResult = {
  /** True only for ENOENT; an existing empty file has missing: false. */
  missing: boolean;
  /** One row per job, sorted by job using case-sensitive code-unit order. */
  rows: DigestRow[];
  /** Nonblank lines with invalid JSON or invalid event shapes. */
  badLines: number;
  /** Counts of ALL valid events, not just each job's last status. */
  counts: Record<DigestStatus, number>;
};

/**
 * Implemented/exported by ./reader.js as readNight(runsDir, night).
 * Synchronous, read-only; no environment, clock, HTML or route dependencies.
 * night must be a real YYYY-MM-DD date; otherwise throws RangeError.
 * Reads runsDir/<night>.jsonl; ENOENT returns an empty missing result;
 * other I/O errors propagate. Blank lines are ignored.
 * Events require a nonempty job, a valid offset-bearing ISO timestamp,
 * a known status, owner: string|null, and optional error: string|null.
 * Extra fields are ignored. Chronological ties use the last line for
 * owner/status/lastAt; firstAt keeps the first tied line.
 * lastError independently tracks the latest non-null error by event instant,
 * with later lines winning ties; recovery or null errors never clear it.
 * Both HTML and JSON consumers must use these same rows and counts.
 */
export type ReadNight = (runsDir: string, night: string) => DigestResult;

import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { lastBeat, type Beat } from './heartbeat.js';
import { readNight } from './digest/reader.js';

export type DigestNightSummary = {
  night: string;
  counts: { ok: number; retry: number; fail: number };
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: string[];
  nightSummaries?: DigestNightSummary[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readStatus(config: RigConfig): Status {
  const nights = nightsOnDisk(config.runsDir);
  const nightSummaries: DigestNightSummary[] = [];

  for (const night of nights) {
    try {
      const result = readNight(config.runsDir, night);
      if (!result.missing) {
        nightSummaries.push({
          night,
          counts: result.counts,
        });
      }
    } catch {
      // If readNight fails for any reason, skip the counts for this night
      // but keep the night in the list for display
    }
  }

  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights,
    nightSummaries,
  };
}

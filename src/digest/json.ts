import { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import type { DigestResult } from './types.js';
import { readNight } from './reader.js';

export function registerDigestJson(app: Hono, config: RigConfig) {
  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');

    try {
      const result = readNight(config.runsDir, night);

      if (result.missing) {
        return c.json(
          { error: 'not found' } as { error: string },
          404,
        );
      }

      return c.json(result as DigestResult, 200);
    } catch (error: unknown) {
      if (
        error instanceof RangeError
        && error.message === 'night must be a real YYYY-MM-DD date'
      ) {
        return c.json(
          { error: 'invalid date' } as { error: string },
          404,
        );
      }
      throw error;
    }
  });
}

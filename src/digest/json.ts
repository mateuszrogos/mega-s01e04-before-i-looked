import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './reader.js';

export function registerDigestJson(app: Hono, config: RigConfig) {
  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');

    try {
      const result = readNight(config.runsDir, night);

      if (result.missing) {
        return c.json(
          { error: 'not found' },
          404,
        );
      }

      return c.json(result, 200);
    } catch (error: unknown) {
      if (error instanceof RangeError) {
        return c.json(
          { error: 'invalid date' },
          404,
        );
      }
      throw error;
    }
  });
}

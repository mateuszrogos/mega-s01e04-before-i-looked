import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { Layout } from '../views/layout.js';
import { DigestPage } from '../views/digest.js';
import { readNight } from './reader.js';

export function registerDigestPage(app: Hono, config: RigConfig) {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    try {
      const digest = readNight(config.runsDir, night);
      if (digest.missing) {
        return c.notFound();
      }
      return c.html(
        <Layout title="digest" lane={lane()}>
          <DigestPage digest={digest} />
        </Layout>,
      );
    } catch (error) {
      if (error instanceof RangeError) {
        return c.notFound();
      }
      throw error;
    }
  });
}

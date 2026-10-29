import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';
import { registerDigestPage } from './digest/page.js';
import { registerDigestJson } from './digest/json.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();
  registerDigestPage(app, config);
  registerDigestJson(app, config);

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  return app;
}

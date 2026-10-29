# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

Requires Node 22 or newer. The service listens on `127.0.0.1` only.

## Morning digest

- `/` links each night to its digest, with all-event ok / retry / fail counts.
- `/digest/2026-10-28` renders the sample night as one self-contained HTML page.
- `/api/digest/2026-10-28` returns the same sorted rows, counts and bad-line count.
- Missing or invalid nights return 404; empty nights render "nothing ran".

`pnpm test` checks the reader and routes. `pnpm typecheck` checks TypeScript.
Keep `.env` and exported preview files outside git. Publish a preview only after
the human approves its host, then replace that same URL without the lane marker
once review is received (ADR 0003).

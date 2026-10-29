---
name: cloudflare-pages-upload
description: Publish, replace or remove one self-contained HTML page on a personal Cloudflare Pages Direct Upload project using Node built-ins, without Wrangler or package installation. Use for an approved static preview that must later lose its marker at the same public URL.
---

# Cloudflare Pages upload

Use the scripts in this skill as the only source; do not copy the skill or client
into another harness. Read `references/contracts.md` before API writes.
Require an existing Node 22+ runtime; install nothing implicitly.

## Boundaries

- Use the human's explicitly chosen personal account, never an implicit work account.
- Ask separately before creating the site/publishing a marked page, replacing it
  without its marker, or tearing down a project. State what, why, exact host/path,
  public visibility and how to undo it. Downloads cannot be recalled.
- Keep credentials, config, HTML exports and live audit logs outside the repo.
  Never put a token on argv or show its file contents. Request a short-lived
  API token with Pages Edit scoped only to the chosen account. Keep IP filtering;
  if denied, compare the execution lane's egress IP before requesting changes.
- Only the explicitly selected HTML file is uploaded. Inspect its data and scripts
  first. `put` rejects script elements but is not a general HTML sanitizer.
- Do not retry an ambiguous write blindly. Read the private audit and project state.
- Do not use the immutable deployment URL as the reviewer link. Record it privately
  so the marked old deployment can also be deleted after replacement.

## Configure privately

Create a private config JSON object with exactly these string keys:
`accountId` (32 lowercase hex characters), `project` (a dedicated project name),
`tokenFile` (absolute path to a mode-0600 file holding only the token), and
`auditFile` (absolute path to a private redacted log). The token and audit files
must differ. Supply credentials using a hidden local prompt or a private editor,
not chat or a shell argument. No account or resource is created by config setup.

## Run

Set `CLIENT` to this skill's absolute `scripts/pages.mjs` path and `CONFIG` to the
private config path. Read flags first:

```sh
node "$CLIENT" --help
node "$CLIENT" check --config "$CONFIG"
```

After the appropriate human approval, create the dedicated project once:

```sh
node "$CLIENT" create --config "$CONFIG" --execute
```

Publish or replace the single HTML file in **one command**:

```sh
node "$CLIENT" put --config "$CONFIG" --file "$HTML" --execute
```

The client verifies a non-Git, main-branch project with no custom domain, uploads
`/index.html`, adds no-store/noindex headers, polls deployment status, and compares
public HTML bytes at the stable HTTPS URL with the chosen file. Record the
returned deployment ID and link privately; never record its HTML or asset JWT.

After review, obtain separate approval to replace the page with the marker-free
export. Verify the local file is clean, run the same `put` command, and verify the
same stable link. Then, with approval, remove each old marked deployment:

```sh
node "$CLIENT" prune --config "$CONFIG" --deployment "$OLD_ID" --execute
```

`prune` refuses current production and confirms API absence. Also check the old
public deployment URLs/aliases no longer serve the marker.

Take the whole dedicated site down in **one command**, only with approval:

```sh
node "$CLIENT" remove --config "$CONFIG" --execute
```

This deletes the dedicated project and all deployments. Verify its public URLs
no longer serve the page. A teardown cannot undo other people's saved copies.

## Verification

Run `node --test <absolute-skill-path>/scripts/pages-check.mjs`.
The suite tests payloads, credential handling, write guards, replacement, cleanup
and all 35 upstream BLAKE3 hash vectors without network or real credentials.
Creation, publication, marker-free replacement and old-deployment pruning were
live-verified on 2026-10-29. The old marked URL returned 404. Full project teardown
is mock-tested only; do not claim it was live-tested.

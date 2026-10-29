# API contracts


Read from Cloudflare's public source on 2026-10-29:

- `https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/pages/projects/projects.ts`:
  `POST /accounts/{account_id}/pages/projects`, JSON body `name: string` and
  `production_branch: string`. Name begins with a lowercase letter/digit and
  contains only lowercase letters, digits or hyphens. Other optional fields
  exist; this client sends none.
- `https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/pages/projects/deployments/deployments.ts`:
  `POST /accounts/{account_id}/pages/projects/{project}/deployments`, multipart
  `manifest: string` (JSON mapping paths to uploaded content hashes, required for
  Direct Upload, max 20,000 entries), `branch?: string`, `_headers?: file`.
  Other optional fields exist; this client sends none. The SDK uses typed
  parameter sets, not an explicit JSON Schema `additionalProperties` guarantee;
  this client sends only the fields declared here.
- `https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/pages/upload.ts`:
  `GET .../upload-token` returns an asset JWT; asset requests use that JWT.
  `POST /pages/assets/check-missing` and `/pages/assets/upsert-hashes` accept
  `{hashes: string[]}`; `POST /pages/assets/upload` accepts an array of
  `{key: string, value: string (base64), metadata: {contentType: string},
  base64: true}`. No extra fields sent. Runtime response checks reject
  unexpected types. These asset endpoints are an official implementation
  contract, not a separately versioned public schema.
- `https://github.com/cloudflare/workers-sdk/blob/main/packages/deploy-helpers/src/deploy/helpers/hash.ts`:
  hash is BLAKE3 of `base64(contents) + extension`, first 32 hex digits.
  The no-dependency hash implementation passes all 35 upstream unkeyed vectors:
  `https://github.com/BLAKE3-team/BLAKE3/blob/master/test_vectors/test_vectors.json`.
- Deployment deletion: `DELETE .../deployments/{id}`. Optional `force` applies
  to non-production deployments with active aliases; client sends no query/body.
  Project deletion: `DELETE .../projects/{project}`. No body.
- Permissions:
  `https://developers.cloudflare.com/fundamentals/api/reference/permissions/`
  lists **Cloudflare Pages Edit** for creating, editing and deleting projects.


# Workspaces, permissions and encrypted secrets

Prompt 4 implements the workspace settings boundary from the authoritative production specification. It does not implement API-test execution, scheduling, queues or deployment.

## Authorization

The API authenticates the PostgreSQL-backed session before constructing an `Actor`. Clients cannot supply a user ID or role. Project, environment and secret routes require `X-Organization-Id`; organization routes use their path organization ID. Services require an explicit `TenantContext` and recheck the verified active user and active membership inside a transaction. Object lookups include the organization ID. Foreign resources and non-members return the same 404 envelope.

| Action                                                                | Owner | Admin | Editor | Viewer |
| --------------------------------------------------------------------- | ----- | ----- | ------ | ------ |
| Read projects, environments, public variables, masked secret metadata | Yes   | Yes   | Yes    | Yes    |
| Change projects, environments, variables, secrets                     | Yes   | Yes   | No     | No     |
| List team and invitations                                             | Yes   | Yes   | No     | No     |
| Invite/change/remove Editor or Viewer                                 | Yes   | Yes   | No     | No     |
| Invite/change/remove Owner or Admin                                   | Yes   | No    | No     | No     |
| Change organization name/slug                                         | Yes   | No    | No     | No     |

Any verified active user may create a workspace and becomes its Owner atomically. Listing the current user's workspaces is a membership-filtered bootstrap operation. Acceptance of an invitation is the other bootstrap exception: the organization, hashed single-use token, verified recipient email and inviter's current authority must all match. Invitations expire in seven days. Resending revokes previous invitations for the same recipient. Admins cannot overwrite pending privileged invitations. SMTP failure revokes that delivery's token; send a new invitation after recovery.

Organization row locks serialize operations with membership changes, including concurrent attempts to remove/demote the last active verified Owner. Permissions are read from PostgreSQL on every operation, not trusted from the browser or cached in a session. These locks deliberately favor correctness; they also serialize reads within a workspace and should be reviewed when scaling. Existing repository exports delegate to these guarded services, not unchecked ID lookups. Raw Prisma access is for trusted internal code only, not an authorization boundary.

The additive `20261004010000_workspaces` migration adds invitations and composite foreign keys for environment-to-project and secret-to-environment tenant consistency. It does not retrofit all future product relations: their services must enforce the same tenant boundary when introduced.

## API

All paths below start with `/api/v1`. Mutations require JSON, the exact configured web Origin and the existing double-submit CSRF cookie/header. Lists accept strict `page` (default 1) and `limit` (default 25, maximum 100). Errors use the shared sanitized envelope; request bodies, validation inputs, database errors and encryption errors are never echoed.

- `GET/POST /organizations`; `GET/PATCH /organizations/:organizationId`.
- `GET /organizations/:organizationId/members`; `PATCH/DELETE /organizations/:organizationId/members/:userId`. PATCH body: `{ "role": "VIEWER" }`.
- `GET/POST /organizations/:organizationId/invites`; `DELETE /organizations/:organizationId/invites/:inviteId`; `POST /organizations/:organizationId/invites/accept`. Create uses email and role; accept uses the emailed token. Tokens/hashes are not returned in list/create responses.
- `GET/POST /projects`; `GET/PATCH/DELETE /projects/:projectId`.
- `GET/POST /projects/:projectId/environments`; `GET/PATCH/DELETE /environments/:environmentId`.
- `GET /environments/:environmentId/secrets`; `PUT/DELETE /environments/:environmentId/secrets/:key`; `POST /environments/:environmentId/secrets/:key/rotate`.

DELETE and rotate requests use an empty JSON object. Secret PUT accepts only `value`. Variable/secret names use uppercase letters, digits and underscores, starting with a letter (maximum 120 characters). Public variables are string-valued JSON, at most 100 entries and 64 KiB encoded; each value is at most 10,000 characters. At most 100 secrets per environment, with 10,000 characters per value. A key cannot exist in both maps. Public variables are intentionally visible to every member: do not put credentials there.

Projects must be empty before deletion. Environments referenced by tests, executions or incidents cannot be deleted; otherwise their secrets are removed with audit events. No organization deletion is exposed. UI destructive actions require confirmation. UI lists display the first 100 entries; full pagination and organization editing are available through the API, not dedicated UI controls yet.

Workspace traffic is limited per 15-minute window to 600 requests per IP and 300 per authenticated user. Sending invitations additionally allows 20 per sender. Counters are durable and shared through PostgreSQL. Reverse-proxy trust remains disabled until deliberately configured at deployment.

## Encryption and key custody

Run `pnpm secrets:init` once after creating your untracked root `.env`. The script generates a random 256-bit key privately, preserves existing keys, honors the configured version, and refuses production/KMS setup. Protect the file using your OS account permissions and keep an encrypted backup outside this repository. Never print, commit, screenshot or paste its contents. The old singular `TENANT_ENCRYPTION_KEY` placeholder is unused.

- `TENANT_KEY_PROVIDER=local` selects the provider-neutral local key ring.
- `TENANT_ENCRYPTION_KEYS` is a private JSON map of positive version numbers to canonical base64-encoded 32-byte keys. No key is shipped in an example or fallback.
- `TENANT_ENCRYPTION_KEY_VERSION=1` selects the version used for new writes.
- `TENANT_ENCRYPTION_CONTEXT=monitorx:environment-secret` binds ciphertext to this application namespace; keep it stable for existing data.

AES-256-GCM uses a fresh 96-bit nonce and a 128-bit authentication tag. The ciphertext envelope carries its format, algorithm, nonce, tag and encrypted bytes; the row carries its key version. Authenticated additional data includes namespace, organization ID, environment ID, secret name, algorithm and version. Moving ciphertext to another context or changing metadata fails authentication. API responses expose only ID, key name, version, timestamps and a constant mask. There is no reveal/decrypt HTTP endpoint. Audits contain entity IDs, action, actor and allowlisted role/key-version metadata, never secret values or ciphertext.

For rotation, securely generate and add a new random key under a new version while retaining all old keys; select that new write version and restart the API. Use each secret's Rotate action to re-encrypt without revealing its value. Confirm all active rows have migrated and that retained backups no longer need the old version before considering removal. Losing old keys or changing the namespace makes old ciphertext unreadable. `secrets:init` is onboarding, not a rotation tool. The deterministic Prompt 2 seed deliberately has fake, non-decryptable ciphertext; replace its fixture through the authorized write path if needed, never weaken validation to accept it.

`KeyProvider` is the deployment integration interface; `getKey(version)` must return an owned key copy which the encryption layer wipes after use. A future KMS adapter can unwrap versioned data keys behind it. `TENANT_KEY_PROVIDER=kms` requires `KMS_KEY_ID` and an injected adapter; the shipped entrypoint has no AWS adapter and fails closed in this mode. Merely setting a KMS identifier does not enable KMS. Local mode needs no AWS credentials. Missing local keys allow other workspace operations but secret writes/rotation fail safely; malformed configured keys fail startup. JavaScript plaintext strings cannot be reliably zeroed from memory, so this is not a memory-isolation guarantee.

## Verification and operational limits

Run `pnpm verify` and, with local PostgreSQL, Redis and Mailpit running, `pnpm test:integration`. Stop the dev server first on Windows so Prisma can regenerate its native driver. Integration fixtures apply all migrations to fresh isolated schemas and drop only those schemas afterward. Coverage includes all four roles, direct service authorization, guessed IDs/forged organization headers, mixed-tenant membership, composite constraints, last-owner races, recipient/expiry/replay/inviter checks, ciphertext tampering, old-key rotation, sanitized responses/audits and actual SMTP delivery.

For manual verification: sign in, create a workspace/project/environment, save public variables and a fake secret, refresh and confirm only a mask remains. Invite a second verified account as Viewer using Mailpit; sign in as that address and reopen the invitation link if registration/verification replaced it. Accept it, verify read-only settings, then change its role as Owner and refresh. Delete only your disposable environment before deleting its project. The complete command sequence is in `howToRun.txt`.

Invitation email is synchronous and has no durable outbox/retry worker yet. Expired invitation cleanup, bulk rotation, audit browsing, production KMS provisioning, and broader product UI belong to later explicitly requested phases. API processes remain stateless; no monitored outbound requests or Redis-owned durable state were introduced.

# Authentication — Prompt 3

This implements the authentication requirements of the final production specification. It does not implement organization authorization, invitations, monitored requests, or dashboards.

## Trust boundaries

- PostgreSQL holds identities, token hashes, session generations, counters and audit records. API instances have no in-memory session or rate-limit source of truth; Redis loss cannot restore revoked sessions.
- Identity/session/email-token records are global and user-owned, not organization-owned. Authentication is not authorization to organization data. Membership checks remain mandatory for future product endpoints.
- Passwords use Node scrypt, N=131072, r=8, p=1, a random 16-byte salt and 64-byte output. Password length is 12–128 characters on creation/reset. Missing accounts also perform a derivation. Each concurrent derivation needs about 128 MiB; budget memory and upstream request concurrency before production.
- Access and refresh values are independent 256-bit random opaque tokens. Only SHA-256 digests are stored. No bearer values, password hashes, OAuth credentials, email links, or request bodies are returned in logs/audit records. Public users expose only ID, display name, email and verification status.
- All browser cookies use `Secure; HttpOnly; SameSite=Lax; Path=/` with `__Host-` names and no Domain. Local verification uses Chrome on `http://localhost`; use HTTPS outside localhost. Do not weaken cookie flags to accommodate an insecure remote origin.
- CSRF protection combines an exact allowed Origin with an unpredictable, host-only double-submit cookie and `X-CSRF-Token` header. The token is obtained through the credentialed `/csrf` endpoint; CORS allows only the configured web origin. Cookie mutations require JSON. OAuth GET callbacks instead use browser-bound state plus PKCE.
- Express does not trust forwarded IP headers. Configure trusted proxy addresses deliberately at deployment time; behind an unconfigured proxy, users share its IP quota. Do not enable blanket `trust proxy`.

## Lifetimes and races

Access tokens expire in 15 minutes. Refresh families have an absolute seven-day lifetime. Refresh marks the old generation used and issues new tokens transactionally. Reusing a used/revoked refresh token revokes every generation in the family. Clients must serialize refresh operations, including across tabs; retrying the old token after a lost response fails closed and requires sign-in. Logout revokes the current family. Reset revokes all of a user's families.

Verification tokens expire after 24 hours; reset tokens after 30 minutes. Both are purpose-bound, single-use and stored only as hashes. Resending supersedes earlier tokens of that purpose. Email links use URL fragments, which the form removes immediately; explicit submission consumes the link, not email scanner GET requests. Password reset does not itself verify an unverified address or bypass administrative account locks.

User-row locks serialize login/reset/refresh/logout and token consumption. Registration uses an email-keyed advisory transaction lock. Bounded Prisma connection acquisition (10 seconds) and transaction timeouts (15 seconds) allow cold local connections while failing closed on database failures. Audits commit in the same transaction as auth state; replay rejection returns only after revocation commits.

After five incorrect passwords, login backs off for 60 seconds. Each subsequent incorrect attempt after the backoff doubles it, capped at one hour. Attempts during backoff do not extend it. Successful verified login or password reset clears the counter. Administrative `LOCKED`/`DISABLED` states are not cleared by these flows.

## Endpoints

All paths are under `/api/v1/auth`:

| Method | Path                                       | Purpose                                     |
| ------ | ------------------------------------------ | ------------------------------------------- |
| GET    | `/csrf`, `/config`                         | CSRF token and public OAuth-enabled setting |
| POST   | `/register`                                | Email, password, displayName; generic 202   |
| POST   | `/login`                                   | Email/password; verified users only         |
| GET    | `/me`                                      | Current public user or generic 401          |
| POST   | `/refresh`, `/logout`                      | Empty JSON object; rotate or revoke session |
| POST   | `/resend-verification`, `/forgot-password` | Email; generic 202                          |
| POST   | `/verify-email`                            | Single-use token                            |
| POST   | `/reset-password`                          | Single-use token and new password           |
| GET    | `/github`, `/github/callback`              | Optional state/PKCE OAuth flow              |

Errors have `{ error: { code, message, requestId } }`; no account-existence, lockout-state, parser input, or provider error details are disclosed. Database failures produce sanitized 503 responses. Registration and email requests return the same accepted message for existing, missing and ineligible accounts. This is response-content protection, not a claim of perfectly constant end-to-end email delivery timing.

PostgreSQL fixed-window limits are shared by all replicas: all auth traffic 120/IP/15min; login 30/IP and 20/email/15min; each registration/email-request route 10/IP and 5/email/15min; reset completion 10/IP/15min. Keys are hashed and responses include Retry-After. Database availability is required; there is no fail-open fallback.

## Email and OAuth

SMTP delivery is compatible with local Mailpit and has bounded connection/socket waits. Remote SMTP requires TLS; file/URL attachments and transport debug logging are disabled. Send failures are audited and return generic accepted responses; users can resend. This phase uses synchronous auth-email delivery, not a durable email outbox. Outbound monitored HTTP requests remain absent from the API; GitHub calls are fixed authentication-provider endpoints only.

GitHub is off by default. When enabled it uses an exact callback, 10-minute single-use hashed state/verifier records, browser cookies and S256 PKCE. Only a verified primary email is accepted for creation, and immutable GitHub ID is the subsequent identity key. Matching an existing password account by email never silently links it; sign in with the original password instead. Provider tokens are not persisted. Account-linking UI is not in this phase.

The provider follows [GitHub's OAuth flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps). SMTP uses pinned Nodemailer 10.0.13 with its current [security fixes](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.13).

## Verification and operations

Run `pnpm verify`, then start Compose and run `pnpm test:integration`. Auth integration tests migrate both migrations into a new random local schema and remove only that schema. SMTP tests remove only their own messages. The original database/Redis tests continue to use the local development database. CI runs both suites.

Manual path: register through the web shell, open the message in Mailpit, follow the verification link, press Verify email, sign in, renew the session, sign out, request/reset the password and sign in with the new password. Inspect cookie flags without copying their values. See the living runbook for exact commands and optional GitHub callback configuration.

Expiry indexes are present but scheduled deletion is not yet implemented. Retain session generations until family expiry so replay detection remains possible. Later maintenance must remove expired email tokens, OAuth attempts and rate counters, and apply the audit retention policy. Deployment still needs HTTPS, a same-site frontend/API arrangement, trusted-proxy configuration, resource/load testing and a live GitHub credentialed smoke check. No public Internet deployment is claimed.

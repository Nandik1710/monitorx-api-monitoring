# Asynchronous runs (Prompt 7)

`POST /api/v1/tests/:id/run` takes an explicit `environmentId`. Collection submission at `/collections/:id/run` also takes `parallelism` (1–5; maximum 100 tests). Both return 202 with a durable run ID after a PostgreSQL transaction, without waiting for Redis or any target request. Owner/Admin/Editor may submit/cancel; Viewer may poll. Disabled definitions may be run manually; enabled controls future scheduling, not manual intent.

Run snapshots contain validated configuration, public variables and only referenced encrypted secret records. No plaintext secret is put in Redis or returned in API responses. Workers recheck requester membership and project state before claiming. A queued snapshot is immutable even when the test/environment is edited. Snapshots are removed at completion/cancellation. PostgreSQL run IDs are BullMQ job IDs; Redis job bodies contain only IDs.

The worker owns `execution`, `collection-run`, `alerts`, `imports`, and `maintenance` queues. Execution and bounded collection coordination are active. Alerts/imports are named queues only; their product processors belong to Prompts 10/11. A two-second reconciler reconstructs missing queued work from PostgreSQL. Maintenance handles interrupted claims. Collection concurrency is protected by a database row lock, not process-local counters.

## Results and failure semantics

Results and individual assertions commit atomically with an `execution.completed` event before a job succeeds. Legitimate target failures/timeouts are normal job outcomes, never automatic target retries. Database persistence retries reuse the in-memory result. If a worker dies after claiming, a 90-second lease expires and the run becomes FAILED with UNKNOWN health: the target outcome is explicitly unknown and the target is not silently retried. This avoids pretending exactly-once external HTTP effects are possible. Cancellation stops queued jobs or requests socket abortion for running jobs; it cannot undo a request already received by a target.

Polling: `GET /runs/:id`, `GET /collection-runs/:id`. Cancellation: `POST /runs/:id/cancel` or `/collection-runs/:id/cancel` with `{}`. Responses deliberately omit snapshots/ciphertext. Execution detail/history arrive in Prompt 9.

## Live events

`/api/v1/events?organizationId=UUID&after=CURSOR` upgrades to WebSocket using the HttpOnly access cookie and exact configured Origin. Session/membership are rechecked every second; unauthorized, expired or revoked clients are closed. Events are durable PostgreSQL rows, ordered with a resumable numeric cursor; Redis Pub/Sub is not a source of truth. The gateway sends only event/run identifiers and safe status metadata, caps frames/backpressure/connections and accepts no client messages. The frontend uses live notifications plus two-second status polling as recovery. Scale-out fanout optimization is future work.

## Local verification

Stop development servers before Prisma generation on Windows. Install locked dependencies, start Compose, migrate, run `pnpm verify` and `pnpm test:integration`, then `pnpm dev`. The worker reads the same root `.env` key ring as the API. `WORKER_CONCURRENCY` defaults to 5. Optional msgpackr native builds are disabled; its JavaScript fallback is used.

Open a saved test, explicitly choose a run environment, press Run now and inspect queued/running/final text. Private/localhost targets must fail policy validation, not be contacted. Use a public API you own/are authorized to monitor for an actual successful manual request. Collection controls support bounded parallelism; cancellation states that sent requests cannot be undone. Automated fixtures use isolated database schemas and random Redis prefixes, never flush shared Redis.

References: [BullMQ unique job IDs](https://docs.bullmq.io/guide/jobs/job-ids), [operational retries](https://docs.bullmq.io/guide/retrying-failing-jobs), [WebSocket upgrade authentication](https://github.com/websockets/ws#client-authentication).

# Scheduling and admission limits (Prompt 8)

Schedules are PostgreSQL configuration. `POST /schedules`, `PATCH /schedules/:id`, and `GET /tests/:id/schedule` require tenant authorization; mutations require Owner/Admin/Editor plus CSRF. Inputs are strict. An explicit same-project environment is mandatory. Creating a schedule defaults disabled; active scheduling requires a saved enabled test. The Schedule tab supports create/edit, pause/resume, thresholds and maintenance.

Cadences: elapsed intervals of 1/5/10/15/30/60 minutes; hourly at a minute offset; daily at a local hour/minute in a validated IANA zone. Hourly/daily calculations use cron-parser's timezone/DST behavior. Maintenance windows are up to 20 absolute UTC half-open `[start,end)` windows, each at most one year. Recurring maintenance rules and arbitrary cron expressions are not exposed. Incident thresholds are stored for Prompt 10, not yet used to open alerts.

## Durable reconciliation

The worker reconciles on startup/every two seconds, pre-materializing up to one minute of future slots. Creation of the execution snapshot and advancement of nextRunAt occur in one transaction. The unique `(testId,scheduledAt,runKind)` index prevents duplicate history; a SHA-256 logical key is the deterministic BullMQ job ID (no forbidden colons). Redis receives only execution IDs and can be rebuilt from PostgreSQL. Duplicate queue delivery is harmless because claims are conditional/locked.

After downtime, one overdue slot is retained and the schedule advances beyond the current time. It does not burst-replay every missed interval. `lastLagMs`, `missed`, `reconciled` and `errors` are available from the worker's internal `/metrics` JSON endpoint; counters are per-process operational metrics, not business records. Restrict worker port access in deployment. A missed counter counts overdue schedules, not every theoretical omitted interval.

Pause/edit cancels queued slots; worker admission rechecks current enabled/paused/maintenance/test state. Cancellation/maintenance executions have PAUSED/UNKNOWN health and are not eligible uptime samples. Resume starts a future slot without replaying the paused period. Legacy schedule rows lacking environment/creator metadata do not auto-run; explicitly recreate/update them through validated configuration.

## Distributed limits and retries

Database admission locks enforce at most 20 running executions globally, 3 per organization and 2 per normalized target hostname, across worker processes. The hostname is stored only as a hash. These are conservative code defaults; per-process WORKER_CONCURRENCY remains 5. Collection parallelism is independently bounded 1–5. Tests inject lower limits to verify cross-processor enforcement.

Optional `Organization.executionRateLimitPerMinute` (1–10000, null by default) is trusted database configuration, not a tenant-editable UI setting. A durable rolling count of admitted starts enforces it independently of Redis loss. Quota-limited work stays QUEUED with `availableAt`, exponential deferral capped at 30 seconds plus at most 500 ms jitter; no worker busy-waits or repeats a target result. Operational queue retry is bounded to four attempts with exponential jitter. Interrupted claimed runs remain UNKNOWN rather than repeating external side effects.

## Verification

Tests cover allowed cadence values, invalid zones, daily spring/autumn DST, maintenance boundaries, concurrent reconciler instances, logical uniqueness, deterministic queue rebuild under a random test prefix, pause/resume, worker admission rechecks, two processor instances sharing limits and quota rescheduling. No test flushes shared Redis. See the Prompt 8 section of howToRun.txt for the local workflow.

Reference: [cron-parser timezone/DST support](https://github.com/harrisiirak/cron-parser).

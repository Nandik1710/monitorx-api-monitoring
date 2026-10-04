# Execution history and reliability views

Prompt 9 adds tenant-authorized, read-only history and dashboards. The API never
sends a monitored request. PostgreSQL remains the source of truth.

## API and pages

- `GET /api/v1/{projects|collections|tests}/:id/executions`: page/limit (maximum
  100), inclusive ISO UTC from/to, status, environmentId, current test tag, runKind.
  Stable newest-first ordering uses creation time plus ID. Default page size 20.
- `GET /api/v1/executions/:id`: whitelisted run metadata, sanitized engine output
  and ordered assertion results. Snapshots, ciphertext, user IDs and lease data
  are never serialized. Expired records return 404; previews older than seven
  days are hidden even before physical cleanup.
- `GET /api/v1/{projects|collections|tests}/:id/dashboard?range=24h|7d|30d`.
- Browser pages: `/app/{projects|collections|tests|executions}/:id?organizationId=UUID`.
  A session and active membership are required, including for Viewer reads.
  The organization in a URL is a selector, never authorization.

Workspace/project selection links to the project dashboard; collection selection
links to its dashboard; test History and run-result links expose details.
Response text is rendered as escaped text, never HTML. Copy controls copy only
the already-redacted view. Status symbols always have accompanying text.

## Metric definitions

- **Uptime**: percentage of eligible scheduled samples that are HEALTHY or
  DEGRADED. DOWN is a failure; UNKNOWN, PAUSED and cancelled outcomes do not enter
  this denominator. This is sample-based availability, not time-weighted SLA.
- **Pass rate**: passed (including legacy DEGRADED status) / all completed
  non-cancelled outcomes, across manual, collection and scheduled runs.
- **Latency**: mean and PostgreSQL continuous p50/p95/p99 across non-null measured
  durations of completed outcomes, including failures. Null duration is excluded.
- Empty denominators return null, displayed as **No data**, never 100%.
- Ranges use completion time; future and expired execution records are excluded.
- Current health uses the latest non-cancelled completed result. Disabled tests,
  disabled/paused schedules and current maintenance are PAUSED. Missing/stale
  results are UNKNOWN: interval freshness is twice the interval (minimum five
  minutes); hourly two hours; daily 26 hours; unscheduled tests 24 hours.
  These freshness rules are explicit implementation defaults, not SLA promises.
- Existing non-resolved incidents count as open; up to ten open or recent records
  are displayed. Automatic incident creation, thresholds and deliveries are NOT
  implemented here: those belong to Prompt 10.

## Scale and retention

Database aggregates compute counts/percentiles/error breakdowns. Composite tenant
and timestamp indexes support filters and indexed lateral latest-result lookups.
Only per-test metadata/current states and per-test averages enter API memory, not
the execution history. This is appropriate for the current local scale; very large
tenants will need rollups, partitioning and query-budget/load testing later.
History uses offset pagination capped at page 10,000, not an unlimited export.
Top endpoint lists contain at most ten entries; error classes at most twenty.

The API enforces a maximum 90-day metadata read window and seven-day preview
visibility. Physical deletion/partition retention jobs are a later lifecycle
phase; hiding a preview is not erasing its stored value. Assertion evidence follows
metadata retention and is sanitized by the worker before persistence.

## Verification

Integration tests exercise PostgreSQL percentile results, denominator exclusions,
empty data, all three scope routes, filtering/pagination, Viewer access, foreign
tenant denial, output whitelisting and expired preview/record behavior. Component
tests cover loading/failure/reload, ranges, empty data, filters, pagination, escaped
text, copy controls and preview expiry. See the living runbook for the browser flow.

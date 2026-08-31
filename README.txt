MONITOR-X PROJECT README
========================

Project identity
----------------
Monitor-X is a developer-focused, multi-tenant web platform for defining API checks, running them manually or on a schedule, validating responses, measuring availability and latency, preserving historical results, detecting incidents, and notifying teams.

The authoritative implementation baseline is:
Supporting Documents/Monitor-X_Final_Production_Specification.pdf

The files named Sem 7 Major.* describe the same API-monitoring topic at a high level. The other PowerPoint formerly named MoniterX Major Sem 7.pptx describes a different utility-bill OCR product and is treated as legacy/conflicting material, not as implementation scope for this repository.

Vision
------
Combine the useful parts of Postman-style request testing, uptime monitoring, performance history, and lightweight incident management in one secure platform.

Primary outcomes
---------------
1. Reduce repetitive manual API verification.
2. Detect outages, regressions, and performance degradation after deployment.
3. Preserve trustworthy history for status, latency, assertions, and incidents.
4. Support multiple teams and environments without exposing credentials.
5. Execute scheduled checks asynchronously so API/dashboard requests are never blocked by monitored APIs.
6. Demonstrate production-grade engineering: secure secrets, tenant isolation, queues, workers, observability, backups, deployment, and rollback.

Supported API styles
--------------------
- REST/JSON: native request builder and JSON assertions.
- GraphQL: HTTP GET/POST with query and variables plus JSON assertions.
- SOAP/XML: generic HTTP request with XML body plus XPath/text assertions.
- Arbitrary HTTP: custom method, headers, parameters, and body where safe.

Version 1.0 scope
-----------------
- Email/password authentication with verified email, password reset, secure sessions, and optional GitHub OAuth.
- Organizations/workspaces, memberships, and RBAC: Owner, Admin, Editor, Viewer.
- Projects, collections, environments, variables, and encrypted secrets.
- Reusable API test builder.
- Manual single-test and collection runs.
- Scheduled monitoring with intervals, daily/hourly schedules, time zones, pause, reconciliation, and idempotency.
- REST, GraphQL, SOAP-style HTTP, and general request support.
- Assertions for status, latency, headers, JSON paths/comparisons, text, regex, XML/XPath, and optional JSON Schema.
- Execution history, redacted response previews, uptime, pass rate, latency percentiles, and error breakdowns.
- Health states: HEALTHY, DEGRADED, DOWN, PAUSED, UNKNOWN.
- Incidents with OPEN, ACKNOWLEDGED, INVESTIGATING, and RESOLVED states.
- Slack, email, and signed generic webhook notifications with retries, deduplication, and cooldowns.
- OpenAPI 3.x JSON/YAML import that creates disabled draft tests.
- Scoped API keys, automation endpoint, CLI, and GitHub Actions integration.
- Audit logs for security and behavior-changing operations.
- Dockerized local/staging operation and AWS deployment documentation/IaC.

Explicitly out of scope for version 1.0
---------------------------------------
- Browser/UI testing and Selenium.
- Full synthetic browser journeys.
- High-volume load testing of customer APIs.
- APM agents inside customer applications.
- Infrastructure monitoring for hosts, CPU, disk, and similar infrastructure metrics.
- Distributed probes from many countries.
- Automatic mutation/fuzz testing.
- Generic project-management functionality.

Core user journey
-----------------
1. Register/login and create an organization.
2. Create a project and an environment such as Development, Staging, or Production.
3. Add non-secret variables and encrypted secrets.
4. Create a collection and API tests, or import an OpenAPI specification.
5. Configure request details, assertions, timeout, and optional latency thresholds.
6. Run a test manually and inspect execution details.
7. Create a recurring schedule.
8. Monitor uptime, latency, pass rate, and failures.
9. Receive an alert when incident rules are met.
10. Acknowledge, investigate, resolve, and review the incident history.

Request builder requirements
----------------------------
- Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, and custom methods only in advanced mode.
- URL templates support deterministic variables such as {{BASE_URL}}.
- Query and header rows have enabled/disabled behavior.
- Bodies: none, JSON, raw text/XML, and x-www-form-urlencoded. Multipart may be added later.
- Authentication: no-auth, bearer token, basic auth, API-key header/query, or custom header.
- Per-test timeout bounded by the organization maximum.
- Redirects disabled by default for monitors; enabled redirects are limited and validated hop by hop.
- Final expanded URLs must be validated before execution.

Assertion behavior
------------------
Each assertion runs independently and appears in execution detail with expected value, actual value, pass/fail state, and message. One failed required assertion fails the test. Warning/soft assertions may mark a result DEGRADED without opening an incident unless configured.

Typical assertions:
- Status equals 200 or is in an allowed list.
- Total latency is below a threshold.
- Header contains an expected value.
- JSON path exists or equals a value.
- Text contains a value.
- Body matches a bounded regular expression.
- XML/XPath value equals an expected value.
- Optional JSON Schema validation.

Health and incident model
-------------------------
- HEALTHY: latest eligible checks pass and latency is within configured limits.
- DEGRADED: API responds but warning assertion or latency threshold is violated.
- DOWN: required assertion fails or request cannot complete under policy.
- PAUSED: monitoring is intentionally disabled or inside maintenance.
- UNKNOWN: there is no recent eligible execution or state cannot be determined.

Default incident policy: open after two consecutive DOWN checks; critical tests may open after one. Resolve after two consecutive healthy checks. Repeated failures update the existing incident instead of creating duplicates. Maintenance windows suppress incident opening and alerts while optionally retaining raw executions.

Target architecture
-------------------
Frontend:
- React + TypeScript + Vite.
- Tailwind CSS for styling.
- TanStack Query for server state.
- Recharts for health and latency charts.

Backend:
- Node.js + Express + TypeScript.
- Stateless REST API under /api/v1.
- WebSocket gateway for authenticated live events.
- Stable JSON error envelope containing code, message, requestId, and details.

Workers and queues:
- Redis + BullMQ for asynchronous work, delayed jobs, retries, backoff, locks, and rate limiting.
- execution queue for manual and scheduled API checks.
- collection-run queue for bounded collection fan-out.
- alerts queue for notification delivery.
- imports queue for OpenAPI parsing and draft test generation.
- maintenance queue for retention, aggregation, and reconciliation.

Persistence:
- PostgreSQL + Prisma is the durable source of truth.
- JSONB is used only for flexible request, assertion, and metadata structures.
- Redis is not a durable replacement for schedule or business state.

Main relational entities
------------------------
users, organizations, memberships, projects, collections, environments, environment_secrets, api_tests, schedules, executions, assertion_results, incidents, incident_events, notification_channels, alert_deliveries, api_keys, and audit_logs.

Important execution rule
------------------------
A worker receives identifiers and immutable execution metadata, reloads authorized configuration from PostgreSQL, expands variables, validates the URL, applies outbound restrictions, executes the request, bounds/decodes the response, evaluates assertions, redacts sensitive information, persists the result, and emits events.

Security requirements
---------------------
- Every organization-owned object is tenant-scoped. Object IDs alone never grant access.
- Passwords use a secure adaptive hash.
- Sessions use short-lived access state and rotating refresh sessions in Secure, HttpOnly, SameSite cookies.
- Authentication events and security-sensitive mutations are audited.
- Tenant secrets are encrypted at rest; full secret values are never returned after save.
- Authorization, Cookie, Set-Cookie, token, and configured sensitive headers are redacted from logs and previews.
- API keys are shown once, stored as strong hashes, scoped, optionally expiring, and immediately revocable.
- Only http and https schemes are accepted.
- Resolve and validate host addresses before requests; reject loopback, private, link-local, multicast, carrier-grade NAT, reserved, and cloud metadata ranges for IPv4 and IPv6.
- Revalidate every redirect and defend against DNS rebinding.
- Do not execute arbitrary user JavaScript in workers.
- Bound request body, response body, headers, timeout, redirects, regex work, and concurrency.
- Use CSRF protections for cookie-authenticated mutations, restrictive CORS, CSP, HSTS after HTTPS rollout, and secure headers.
- Worker egress must be isolated from control-plane and sensitive internal endpoints.

Reliability and SLO targets
---------------------------
- Monitor-X control-plane API availability: 99.9% monthly excluding planned maintenance.
- Ordinary API/dashboard reads: p95 below 400 ms under expected load.
- 95% of due checks start within 60 seconds of scheduled time.
- A completed worker run is persisted before it is considered successful.
- 95% of incident-open alerts are enqueued within 30 seconds of state change.
- API/worker restart must not lose schedules or execution history.
- Scheduled idempotency tuple: test_id + scheduled_at + run_kind.

Default retention
-----------------
- Execution metadata: 90 days, configurable.
- Response previews: 7 days, truncated and redacted.
- Full response artifacts: disabled by default; optional encrypted short-TTL object storage.
- Incidents: 1 year.
- Audit logs: 1 year.
- Queue metadata: short operational retention only.

Backend endpoint map
--------------------
- POST /api/v1/auth/register
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/logout
- GET/POST /api/v1/organizations
- POST /api/v1/organizations/:id/invites
- PATCH /api/v1/organizations/:id/members/:userId
- GET/POST /api/v1/projects
- GET /api/v1/collections/:id
- POST /api/v1/collections
- POST/PATCH /api/v1/tests and /api/v1/tests/:id
- POST /api/v1/tests/:id/run
- GET /api/v1/tests/:id/executions
- GET /api/v1/executions/:id
- POST /api/v1/collections/:id/run
- POST/PATCH /api/v1/schedules and /api/v1/schedules/:id
- GET /api/v1/metrics/tests/:id
- GET/PATCH /api/v1/incidents and /api/v1/incidents/:id/state
- POST /api/v1/notification-channels
- POST /api/v1/notification-channels/:id/test
- POST /api/v1/imports/openapi
- POST /api/v1/api-keys
- DELETE /api/v1/api-keys/:id
- GET /api/v1/audit-logs
- POST /api/v1/automation/collections/:collectionId/runs

Frontend routes
---------------
/login, /register, /app, /app/projects/:id, /app/collections/:id, /app/tests/:id, /app/executions/:id, /app/incidents, /app/alerts, /app/team, /app/settings/environments, /app/settings/api-keys, and /app/audit.

AWS production target
---------------------
- Route 53: DNS.
- ACM: TLS certificates.
- S3 + CloudFront: static React frontend.
- WAF: web/API protection.
- ALB: public HTTPS ingress to API.
- ECS Fargate: API, execution workers, alert workers, import workers, and maintenance worker.
- ECR: immutable container images.
- RDS PostgreSQL: durable relational database with backups/PITR and Multi-AZ when budget requires.
- ElastiCache Redis: queues, locks, and rate limiting.
- Secrets Manager + KMS: infrastructure and encryption-key protection.
- CloudWatch: logs, metrics, dashboards, alarms.
- SES or another provider: email alerts.
- Private subnets for API, workers, database, and Redis; controlled NAT egress for workers.

Testing strategy
----------------
- Unit: validators, assertion engine, schedule calculations, authentication helpers, rate limiting.
- Integration: API routes, repositories, PostgreSQL/Redis behavior, queue behavior, tenant isolation.
- Worker integration: mock targets for timeouts, redirects, large bodies, DNS/IP restrictions, retries, and persistence.
- End-to-end: login, create test, run, schedule, view result, incident workflow.
- Load/performance: API reads, run submission, and WebSocket fan-out under expected usage.
- Security: dependency audit, SAST, secret scanning, OWASP ZAP in staging, dedicated SSRF regression tests.

Mandatory regression cases
---------------------------
- Organization A cannot read or update organization B data.
- Local/private/link-local/metadata targets and redirects to them are blocked.
- Secrets and Authorization/Cookie headers never appear in logs or previews.
- Redis loss rebuilds future schedules from PostgreSQL.
- Worker crash after outbound call does not duplicate logical executions.
- Alert provider failure retries without duplicating incidents.
- Database migrations are safe during rolling deployments.

Definition of done
------------------
The product is complete only when the product acceptance list in the specification passes, including tenant isolation, asynchronous execution, durable scheduling, execution detail, metrics, incident lifecycle, real notifications, OpenAPI draft import, CI trigger support, SSRF regression tests, redaction, Dockerized staging, CloudWatch/backups/rollback verification, and a complete README/runbook/demo.

Build priority
--------------
Build the execution engine and durable job model before dashboards. A dashboard is useful only when the underlying execution, scheduling, and persistence are reliable.

Implementation order
--------------------
The exact 15 prompts for building from zero to completion are in Prompts.txt. Use one prompt at a time, in order. Do not skip a prompt or ask Codex to claim work that has not been implemented and tested.

Repository structure
--------------------
apps/
  web/                         React frontend
  api/                         Express REST API and WebSocket gateway
  worker/                      BullMQ execution, alert, import, and maintenance workers
packages/
  db/                          Prisma schema, migrations, client, repositories, seed
  contracts/                   Shared Zod/API contracts and types
  test-engine/                 Request normalization, assertions, SSRF, redaction
  security/                    Encryption, API keys, audit helpers, security primitives
  ui/                          Shared React components, forms, charts, viewers
  cli/                         Monitor-X CI/CD command-line client
infra/cdk/                     AWS CDK stacks and infrastructure tests
docker/                        Container files and local service configuration
.github/workflows/             CI/CD workflows
docs/                          Architecture, API, runbooks, and ADRs
tests/                         Cross-package unit, integration, E2E, security, and fixtures
scripts/                       Development, migration, seed, smoke-test, and operations helpers



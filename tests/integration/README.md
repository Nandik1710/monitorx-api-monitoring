# Integration test setup

These tests are opt-in because they require running PostgreSQL, Redis, and Mailpit instances.

1. Start the local stack: `docker compose -f docker/compose.yml up -d --wait`.
2. Apply the schema: `pnpm db:migrate`.
3. Run the integration suite: `pnpm test:integration`.

The suite checks both connections, a PostgreSQL uniqueness constraint, and an explicit organization-scoped
lookup. It uses temporary records and removes them after the run.

# Authentication verification (Prompt 3)

Start all three Compose services, including Mailpit, before running `pnpm test:integration`.
The authentication suite creates a random `monitorx_auth_test_*` schema in the local PostgreSQL database,
applies all migrations using Prisma, and drops only that schema afterwards. `AUTH_TEST_DATABASE_URL` may
select a different local database; remote hosts are rejected. No production database is appropriate.
The SMTP test sends fake messages through port 1025, checks their link fragments through Mailpit's API on
8025, and deletes only the messages it created. No token values are logged.

The original database/Redis tests above still use the development database and must follow their existing
setup. Ordinary `pnpm test` skips all integration suites. See `docs/architecture/authentication.md` for
security decisions and the living `howToRun.txt` for the browser walkthrough.

## Workspace verification (Prompt 4)

The workspace suite applies all current migrations to its own random `monitorx_tenant_test_*` schema on local PostgreSQL. It tests route and service authorization, all four roles, cross-workspace identifier attacks, tenant foreign keys, invitation lifecycle and concurrent last-owner protection, masked secret responses, audit redaction and versioned authenticated encryption. Keys and session tokens are generated in memory and never logged. Real SMTP checks cover invitations as well as verification and reset messages.

Stop development servers before running checks on Windows: Prisma generation cannot replace a native driver loaded by an active API process. No AWS/KMS configuration or real credentials are required. See `docs/architecture/workspaces.md` for scope and limitations.

## Request-builder verification (Prompt 5)

The builder suite applies all four migrations to a random `monitorx_builder_test_*` local schema, then removes only that schema. It covers collection/test CRUD, pagination, Owner/Admin/Editor/Viewer permissions, cross-tenant and cross-project foreign keys, strict inputs, CSRF, revision races, audit redaction, deletion guards, timeout ceilings and bounded masked previews. Malformed ciphertext still previews safely because only secret names are queried. A local HTTP fixture receives zero monitored requests during save/read/preview; no run endpoint or execution is created. Fixture accounts, sessions and encryption keys are temporary and never logged.

The ordinary suite also includes shared-contract and jsdom component tests; these do not require Docker. See `docs/architecture/test-builder.md` and the Prompt 5 section of `howToRun.txt` for manual verification.

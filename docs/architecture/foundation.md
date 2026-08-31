# Monitor-X foundation

Phase 1 establishes the repository and local development boundary described by the production specification.

- `apps/web` is the React/Vite browser shell.
- `apps/api` is a stateless Express service with live and readiness health endpoints.
- `apps/worker` owns the worker process boundary and exposes a separate health server.
- `packages/*` are independent TypeScript package boundaries for later domain work.
- `docker/compose.yml` provides pinned PostgreSQL, Redis, and Mailpit services for local development.

No product domain behavior, database schema, queue processing, outbound request execution, authentication, or
authorization is implemented in this phase.

# Local foundation runbook

1. Copy `.env.example` to `.env` and replace only the placeholder local secrets with random values.
2. Run `pnpm install --frozen-lockfile`.
3. Start services with `docker compose -f docker/compose.yml up -d`.
4. Run `pnpm dev`.
5. Open `http://localhost:5173`, `http://localhost:4000/health/ready`, and
   `http://localhost:4100/health/ready`.
6. Open Mailpit at `http://localhost:8025`.

The Compose credentials are local-only development values. Never reuse them outside this workstation.

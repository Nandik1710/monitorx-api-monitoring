# Monitor-X data layer

Prompt 2 establishes PostgreSQL as the durable source of truth. Prisma owns the typed client and committed migration
under `packages/db/prisma/`. Redis remains an external, reconstructible integration dependency for future queues and
locks; no business state is stored only in Redis.

Every organization-owned table carries an `organizationId` column and organization-first indexes where the access
pattern is tenant-scoped. Repository methods require the organization identifier for object lookups. Future API
services must pass the authenticated tenant context rather than querying by object ID alone.

The seed uses fixed UUIDs, fake local values, and a fixed timestamp. It is safe to rerun because records are upserted.
Secret-like and channel-like seed fields are fixture ciphertext markers, not usable credentials.

# API test configuration (Prompt 5)

This phase stores reusable HTTP request definitions. It does not execute monitored requests, resolve DNS, evaluate assertions, enqueue jobs, or create schedules. The Schedule and History tabs say explicitly that those features are not available yet. An enabled definition is not an active monitor.

## Authorization and storage

Owner, Admin and Editor can create/update/delete collections and tests. Viewer can read definitions and generate a masked preview. Workspace/project/environment administration remains Owner/Admin-only. Every route runs after the existing authentication, CSRF, exact-origin CORS and database rate-limit middleware. `X-Organization-Id` is mandatory. Shared services recheck active membership and constrain every object lookup to the authenticated organization, including matching the collection and selected environment to the same project. A second membership does not authorize mixing resources between selected workspaces.

The additive `20261004020000_test_builder` migration adds `advancedMethod`, `maxRedirects`, `formRows`, `revision`, a disabled-by-default test flag and an organization timeout ceiling. Composite foreign keys enforce collection/project/test/environment consistency independently of the services. Existing rows are not silently rewritten. A legacy malformed definition fails closed on read; the old seed's null no-auth value is normalized to `NONE` in the DTO. Old out-of-policy definitions may require an explicit data repair, not automatic weakening of validation.

PATCH requires `expectedRevision`; the service merges the change with the saved definition, validates the complete result and increments its revision atomically. A stale edit returns 409 instead of overwriting another edit. A test cannot change projects; moving it to another collection is supported by the API only within the same project. Audit events record actor, organization, entity ID, revision and changed field names, including URL/auth/assertion changes. They do not store request bodies, URLs, credentials or full before/after snapshots. Full rollback/version browsing is not implemented.

Deletion is explicit and confirmed in the UI. Collections must be empty. Tests with executions, schedules or incidents cannot be deleted; disable them instead. An environment referenced by a test is protected by the existing environment service.

## Endpoints

All paths are under `/api/v1`, with credentialed sessions and the same CSRF requirements as Prompt 4. Lists return `{items,total,page,limit}`; default page 1/limit 25, maximum limit 100. The UI paginates collections and tests in pages of 20.

| Method | Path                                         | Input                                                          |
| ------ | -------------------------------------------- | -------------------------------------------------------------- |
| GET    | `/collections?projectId=...&page=1&limit=25` | Same-tenant project ID                                         |
| POST   | `/collections`                               | projectId, name, optional description                          |
| GET    | `/collections/:id`                           | Collection metadata; tests are a separate paginated query      |
| PATCH  | `/collections/:id`                           | name and/or nullable description                               |
| DELETE | `/collections/:id`                           | Empty JSON object                                              |
| GET    | `/tests?collectionId=...&page=1&limit=25`    | Same-tenant collection ID                                      |
| POST   | `/tests`                                     | Complete definition; defaults apply                            |
| GET    | `/tests/:id`                                 | Definition and revision                                        |
| PATCH  | `/tests/:id`                                 | expectedRevision plus changed definition fields                |
| DELETE | `/tests/:id`                                 | expectedRevision                                               |
| POST   | `/tests/preview`                             | Unsaved complete definition, same validation and tenant checks |

Unknown fields, invalid types, conflicting settings and oversized values are rejected. Validation messages identify top-level fields and safe reasons, never raw inputs, unknown property names or enum values. Duplicate names return a sanitized 409. Missing/foreign objects return 404. No `/tests/:id/run` endpoint is introduced.

## Definition contract

- Standard methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS. Uppercase alphabetic custom methods up to 16 characters require `advancedMethod=true`; CONNECT/TRACE/TRACK are rejected. GET/HEAD must use no body.
- Absolute HTTP(S) URL or a base variable such as `{{BASE_URL}}/health`, maximum 2,048 characters. No embedded username/password, fragments, whitespace, backslashes or control characters. This is syntax validation, not an SSRF safety certification. Private targets may be stored but cannot be executed in this phase. Prompt 6 must enforce DNS/IP/redirect/TLS safeguards before any actual request.
- Query/header/form rows have key, value, enabled and sensitive flags. At most 100 per group; values at most 10,000 characters. Transport-managed headers such as Host, Content-Length, Transfer-Encoding and Connection are rejected. Enabled header names are case-insensitively unique. Headers are capped at 16 KiB of serialized definition data.
- Body modes: NONE, JSON, RAW, XML and FORM_URLENCODED. JSON is syntactically checked; references must appear in JSON strings, for example `{"id":"{{ITEM_ID}}"}`. Form bodies use structured rows, not `bodyTemplate`. Body size is capped at a conservative 256 KiB, below the specification's recommended 1 MiB ceiling. GraphQL uses JSON query/variables; SOAP uses XML. XML and regex are stored, never evaluated by this phase. Multipart is deferred.
- Timeout: 100–30,000 ms, default 10,000, additionally constrained by `Organization.testTimeoutLimitMs` (default 30,000). The lower organization ceiling currently requires trusted deployment/database configuration; no administration UI is exposed for it.
- Redirects: off by default with `maxRedirects=0`; enabling requires 1–3 hops. Future workers must revalidate every hop. No insecure TLS switch exists.
- Tags: up to 50 unique tags, each 1–50 characters. Enabled defaults to false. Enabling requires an explicit environment. Literal disabled drafts may have no environment; references must resolve against a selected environment even for drafts.
- Up to 100 strictly typed assertions: status code/list, latency upper threshold, header exists/equals/contains, JSON path existence, scalar JSON comparison, text equals/contains, bounded regex definition and XPath equality. Each has REQUIRED or WARNING severity. Regex definitions are length-bounded but intentionally not compiled/run yet; safe execution and detailed path/pattern validation belong to Prompt 6. Optional JSON Schema assertions are deferred.

## Credentials, variables and previews

Use exact, uppercase, case-sensitive `{{NAME}}` references. There is no JavaScript, expression evaluation or recursive expansion. Repeated references resolve consistently; unknown variables fail validation. An environment must belong to the test's project.

Authentication configuration is a strict discriminated object:

```json
{ "type": "NONE" }
{ "type": "BEARER", "token": "{{API_TOKEN}}" }
{ "type": "BASIC", "username": "service-user", "password": "{{PASSWORD}}" }
{ "type": "API_KEY", "in": "HEADER", "name": "X-API-Key", "value": "{{API_KEY}}" }
{ "type": "CUSTOM_HEADER", "name": "X-Token", "value": "{{API_TOKEN}}" }
```

API_KEY also supports `in: "QUERY"`. Credential values must reference encrypted environment secrets, not public variables or literal credentials. Known sensitive row names (authorization, cookie, API key, token, secret, password) and user-marked sensitive rows require secret references too. Sensitive query parameters embedded in the URL follow the same rule. Do not put real credentials in ordinary names, bodies, assertion expectations or unmarked values: those are intentionally stored as public definition data, and no system can infer every arbitrary credential. Use environment secret references everywhere credentials are needed.

Preview selects only public variables and secret names—never ciphertext or encryption keys—and substitutes a constant mask for every secret. A broken encryption key/ciphertext does not cause decryption in the API. Expanded strings and the complete preview are bounded before delivery; repetitive variables cannot allocate an unbounded preview. The preview is illustrative, not a normalized executable request or proof that a destination is allowed. It keeps query/form rows separate and does not fetch the target. JSON/XML escaping and URL encoding for actual requests are worker responsibilities in Prompt 6.

The environment chooser currently lists the first 100 project environments; collection and test lists are fully paginated. The builder is embedded under the selected project in the existing authenticated shell, not a complete routed dashboard. Shared UI components provide labelled fields, notices, buttons and keyboard-operable tabs. Drafts live in component memory only—no localStorage or token persistence is added. Closing/unmounting the editor discards unsaved changes.

## Verification

Stop the development server on Windows before Prisma generation. Run `pnpm verify` and `pnpm test:integration` with the local Compose services. Contract tests cover safe defaults, all body/auth modes, malformed/oversized definitions, template behavior and sensitive-value rejection. Component tests cover tabs, editing, validation, optimistic conflicts, masked previews, collection loading and Viewer controls. Fresh-schema API tests cover CRUD, tenant/project constraints, all four roles, revision races, audit metadata, CSRF, protected deletion, workspace timeouts and an HTTP fixture that receives zero requests during save/read/preview.

Manual path: sign in, select a workspace/project, create a collection, click New API test, set a URL and environment, add an assertion, preview the masked values and save. Reopen the definition to confirm persistence; test invalid input and Viewer read-only access. Exact commands and a first-test walkthrough are in the Prompt 5 section of `howToRun.txt`.

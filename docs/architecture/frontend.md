# Desktop frontend and theme

The post-Prompt-9 redesign keeps the React 19 / Vite 6 application and existing
API contracts. It does not add Prompt 10 features or move monitored requests into
the browser/API. PostgreSQL and worker execution remain unchanged.

## Visual system

- The supplied VS Code palette provides blue-tinted light/dark surfaces. The
  user's final choice adds rose primary, sidebar and chart colors. Dark is the
  first-visit default; the top-right control persists only a theme preference.
- Source Code Pro Variable is the interface/monospace font; Source Serif 4
  Variable is used for prose. Fonts are bundled locally, not fetched at runtime.
- Tailwind 4.3.3, tw-animate-css 1.4.0, shadcn 4.21.1 and Remix icons 4.9.0 are
  pinned. `apps/web/components.json` records base-rhea, remixicon,
  default-translucent menus and subtle menu accents.
- Shared buttons use Base UI 1.8.0 with class-variance-authority, clsx and
  tailwind-merge. Destructive/unsaved-edit confirmation uses Base UI AlertDialog.
  Inputs/selects remain accessible native controls with the same theme tokens.
- The supplied registry configuration was integrated manually into the existing
  Vite app, not run twice as a destructive project initializer. Duplicate font
  declarations, circular font variables and the pasted trailing CSS brace were
  corrected. Dark muted text is slightly brighter for readability.
- Supported target is laptop/desktop, minimum 1024 CSS pixels. Tables/code scroll
  inside their containers. Reduced-motion preferences disable page animations.
  Mobile optimization is no longer an acceptance criterion for this redesign.

## Page structure

React Router 7.18.4 supplies client navigation, refreshable addresses, back/forward
history and navigation blocking. All organization-owned pages require
`?organizationId=UUID`; nested result links carry `projectId` where available.
Neither query parameter is authorization: the API still checks membership.

| Route                                     | Purpose                                                        |
| ----------------------------------------- | -------------------------------------------------------------- |
| `/auth/:mode`                             | Sign-in, registration, verification, resend and password reset |
| `/app/workspaces`                         | Workspace list, create and invitation acceptance               |
| `/app/projects`                           | Projects in the chosen workspace                               |
| `/app/projects/:id`                       | Reliability overview                                           |
| `/app/projects/:id/tests`                 | Collection library                                             |
| `/app/collections/:id`                    | Saved tests and collection settings/run controls               |
| `/app/collections/:id/new-test`           | New test editor                                                |
| `/app/tests/:id/edit`                     | Request, body, assertions, environment, schedule, history      |
| `/app/tests/:id`                          | Test reliability and history                                   |
| `/app/collections/:id/overview`           | Collection reliability                                         |
| `/app/{projects,collections}/:id/history` | Filtered execution history                                     |
| `/app/executions/:id`                     | Redacted execution details and assertions                      |
| `/app/projects/:id/environments`          | Variables and encrypted-secret management                      |
| `/app/projects/:id/settings`              | Rename/delete-empty project                                    |
| `/app/team`                               | Invitations and role management                                |
| `/app/guide`                              | In-app quick start                                             |

## State and safety

- Session and workspace providers are separate from page modules. Resource
  requests validate their output with shared Zod schemas, clear old data and
  ignore responses after unmount. Scope changes mask old project records.
- Authentication tokens from email fragments are validated, retained only in
  memory and removed from the address bar. Session expiry returns to sign-in.
  Refresh-session action remains available; drafts are not persisted across
  expiry/reload because they can contain sensitive request data.
- Test-definition changes prompt before in-app navigation; browser close/reload
  uses the browser's native warning. Successful saves clear the dirty flag.
  Schedule/environment forms remain explicit-save forms, not autosaved drafts.
- Viewer editing/run controls are hidden or disabled, and server authorization
  remains authoritative. Secret values are password inputs, reset after writes;
  reads show masked metadata only. No new secret/configuration is required.
- Workspace/project/environment/member lists retain the existing 100-item bound;
  collection/test/history lists retain pagination. This is not an unlimited-list
  or production-scale UI claim.

## Verification and manual path

`tests/unit/frontend-navigation.test.tsx` covers protected deep links, invalid
scope, access denial, Viewer controls, dirty-navigation cancel/confirm, clean save
navigation, theme persistence, email-token handling, session expiry and scoped
result links. Existing builder, schedule, history and run-control tests remain.

Run `pnpm verify` with API/worker stopped, then `pnpm dev`. Windows cannot
regenerate Prisma's native DLL while a process is using it. Do not delete data to
resolve that lock. A deployment host must serve `index.html` for frontend routes;
Vite dev/preview already provide this fallback.

Manual smoke path: sign in → workspace → project → environment → collection →
new test → save → reopen → choose Run environment → Run now → execution → history.
Use only a public API you own or are authorized to monitor. Check light/dark,
browser Back and direct reload, keyboard tabs, discard/cancel, and a Viewer
account. Scheduled uptime remains "No data" until eligible scheduled samples
exist. Incidents are read-only until a separately requested later phase.

import { z } from "zod";
import { invitationViewSchema, memberViewSchema } from "@monitorx/contracts";
import { Button, Field, useConfirm } from "@monitorx/ui";
import { useScope } from "../scope.js";
import { useResource } from "../reliability/use-resource.js";
import { workspaceRequest as api } from "../workspace-api.js";
import {
  PageHeader,
  EmptyState,
  Loading,
  formValue,
  useAction,
} from "./shared.js";
const membersPage = z.object({ items: z.array(memberViewSchema) }),
  invitesPage = z.object({ items: z.array(invitationViewSchema) });
export function TeamPage() {
  const scope = useScope();
  return scope.manage ? (
    <TeamContent />
  ) : (
    <>
      <PageHeader
        title="Team & access"
        description="Workspace permissions are managed by Owners and Admins."
      />
      <EmptyState title="Read-only access">
        Ask a workspace Owner or Admin to manage invitations and roles.
      </EmptyState>
    </>
  );
}
function TeamContent() {
  const scope = useScope(),
    action = useAction(),
    confirm = useConfirm();
  const members = useResource(
      `/organizations/${scope.organizationId}/members?limit=100`,
      scope.organizationId,
      membersPage,
    ),
    invites = useResource(
      `/organizations/${scope.organizationId}/invites?limit=100`,
      scope.organizationId,
      invitesPage,
    );
  const roles =
    scope.organization?.role === "OWNER"
      ? ["OWNER", "ADMIN", "EDITOR", "VIEWER"]
      : ["EDITOR", "VIEWER"];
  return (
    <>
      <PageHeader
        title="Team & access"
        description="Give the right people the right access. Viewers can inspect results without changing tests."
      />
      {action.notice}
      <section className="panel">
        <h3>Invite a teammate</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void action.run(async (): Promise<void | false> => {
              await api(
                `/organizations/${scope.organizationId}/invites`,
                "POST",
                {
                  email: formValue(form, "email"),
                  role: formValue(form, "role"),
                },
              );
              form.reset();
              invites.reload();
            }, "Invitation sent. Check the recipient’s email.");
          }}
        >
          <fieldset disabled={action.busy}>
            <div className="form-grid">
              <Field label="Invitation email">
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="teammate@company.com"
                />
              </Field>
              <Field label="Invitation role">
                <select name="role" defaultValue="VIEWER">
                  {roles.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Button type="submit" variant="primary">
              Send invitation
            </Button>
          </fieldset>
        </form>
      </section>
      <section className="panel">
        <h3>Members</h3>
        {!members.data ? (
          <Loading error={members.error} reload={members.reload} />
        ) : (
          <ul className="record-list">
            {members.data.items.map((m) => (
              <li key={m.id}>
                <div>
                  <strong>{m.user.displayName}</strong>
                  <small>
                    {m.user.email} · {m.status}
                  </small>
                </div>
                {m.status === "ACTIVE" &&
                (scope.organization?.role === "OWNER" ||
                  ["EDITOR", "VIEWER"].includes(m.role)) ? (
                  <form
                    className="row-actions"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      void action.run(async (): Promise<void | false> => {
                        await api(
                          `/organizations/${scope.organizationId}/members/${m.userId}`,
                          "PATCH",
                          { role: formValue(form, "role") },
                        );
                        members.reload();
                        scope.refresh();
                      });
                    }}
                  >
                    <select
                      aria-label={`Role for ${m.user.email}`}
                      name="role"
                      key={m.role}
                      defaultValue={m.role}
                      disabled={action.busy}
                    >
                      {roles.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                    <Button type="submit" disabled={action.busy}>
                      Save role
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async (): Promise<void | false> => {
                          if (
                            !(await confirm(
                              `Remove ${m.user.email} from this workspace?`,
                            ))
                          )
                            return false;
                          await api(
                            `/organizations/${scope.organizationId}/members/${m.userId}`,
                            "DELETE",
                            {},
                          );
                          members.reload();
                          scope.refresh();
                        })
                      }
                    >
                      Remove
                    </Button>
                  </form>
                ) : (
                  <span className="role-badge">{m.role}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <h3>Invitations</h3>
        {!invites.data ? (
          <Loading error={invites.error} reload={invites.reload} />
        ) : invites.data.items.length ? (
          <ul className="record-list">
            {invites.data.items.map((i) => (
              <li key={i.id}>
                <div>
                  <strong>{i.email}</strong>
                  <small>
                    {i.role} ·{" "}
                    {i.acceptedAt
                      ? "Accepted"
                      : i.revokedAt
                        ? "Revoked"
                        : new Date(i.expiresAt) < new Date()
                          ? "Expired"
                          : "Pending"}
                  </small>
                </div>
                {!i.acceptedAt &&
                  !i.revokedAt &&
                  (scope.organization?.role === "OWNER" ||
                    ["EDITOR", "VIEWER"].includes(i.role)) && (
                    <Button
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async (): Promise<void | false> => {
                          if (!(await confirm("Revoke this invitation?")))
                            return false;
                          await api(
                            `/organizations/${scope.organizationId}/invites/${i.id}`,
                            "DELETE",
                            {},
                          );
                          invites.reload();
                        })
                      }
                    >
                      Revoke
                    </Button>
                  )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="list-note">No invitations yet.</p>
        )}
      </section>
    </>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { organizationViewSchema, projectViewSchema } from "@monitorx/contracts";
import { Button, Field, useConfirm } from "@monitorx/ui";
import {
  RiAddLine,
  RiArrowRightUpLine,
  RiFolder3Line,
  RiStackLine,
} from "@remixicon/react";
import { useScope } from "../scope.js";
import { useSession } from "../session.js";
import { AppLink, scopedLink } from "../navigation.js";
import { workspaceRequest as api } from "../workspace-api.js";
import {
  PageHeader,
  EmptyState,
  NameFields,
  formValue,
  useAction,
} from "./shared.js";
export function WorkspacesPage() {
  const scope = useScope(),
    session = useSession(),
    action = useAction(),
    navigate = useNavigate();
  const [create, setCreate] = useState(false);
  return (
    <>
      <PageHeader
        title="Your workspaces"
        description="A dedicated home for each team, its projects and its people."
        action={
          <Button variant="primary" onClick={() => setCreate((v) => !v)}>
            <RiAddLine size={18} />
            New workspace
          </Button>
        }
      />
      {action.notice}
      {session.link?.kind === "invitation" && (
        <section className="panel invite-banner">
          <h3>You have a workspace invitation</h3>
          <p>Accept using the account that received the email.</p>
          <Button
            disabled={action.busy}
            onClick={() =>
              void action.run(async (): Promise<void | false> => {
                await api(
                  `/organizations/${session.link!.organizationId}/invites/accept`,
                  "POST",
                  { token: session.link!.token },
                );
                session.clearLink();
                scope.refresh();
              })
            }
          >
            Accept invitation
          </Button>
        </section>
      )}
      {create && (
        <section className="panel">
          <h3>Create a workspace</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void action.run(async (): Promise<void | false> => {
                const org = organizationViewSchema.parse(
                  await api("/organizations", "POST", {
                    name: formValue(form, "name"),
                    slug: formValue(form, "slug"),
                  }),
                );
                scope.refresh();
                navigate(scopedLink("/app/projects", org.id));
              });
            }}
          >
            <fieldset disabled={action.busy}>
              <NameFields />
              <Button type="submit" variant="primary">
                Create workspace
              </Button>
            </fieldset>
          </form>
        </section>
      )}
      {scope.organizations.length ? (
        <div className="entity-grid">
          {scope.organizations.map((o) => (
            <AppLink
              key={o.id}
              href={scopedLink("/app/projects", o.id)}
              className="entity-card"
            >
              <div className="entity-card-top">
                <span className="entity-icon">
                  <RiStackLine size={22} />
                </span>
                <span className="role-badge">{o.role}</span>
              </div>
              <h3>{o.name}</h3>
              <p>/{o.slug}</p>
              <div className="entity-card-bottom">
                <span>Open workspace</span>
                <RiArrowRightUpLine size={20} />
              </div>
            </AppLink>
          ))}
        </div>
      ) : (
        <EmptyState title="Make room for your first project">
          Create a workspace to organize API checks and invite your team.
        </EmptyState>
      )}
      <p className="list-note">Showing up to 100 workspaces you can access.</p>
    </>
  );
}
export function ProjectsPage() {
  const scope = useScope(),
    action = useAction(),
    navigate = useNavigate();
  const [create, setCreate] = useState(false);
  if (!scope.organization)
    return (
      <EmptyState title="Choose a workspace" href="/app/workspaces">
        Projects belong to a workspace. Choose one to continue.
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        eyebrow={scope.organization.name}
        title="Projects"
        description="Keep related services, environments and reliability checks together."
        action={
          scope.manage && (
            <Button variant="primary" onClick={() => setCreate((v) => !v)}>
              <RiAddLine size={18} />
              New project
            </Button>
          )
        }
      />
      {action.notice}
      {create && (
        <section className="panel">
          <h3>Create project</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void action.run(async (): Promise<void | false> => {
                const p = projectViewSchema.parse(
                  await api(
                    "/projects",
                    "POST",
                    {
                      name: formValue(form, "name"),
                      slug: formValue(form, "slug"),
                    },
                    scope.organizationId,
                  ),
                );
                scope.refresh();
                navigate(
                  scopedLink(`/app/projects/${p.id}`, scope.organizationId),
                );
              });
            }}
          >
            <fieldset disabled={action.busy}>
              <NameFields />
              <Button type="submit" variant="primary">
                Create project
              </Button>
            </fieldset>
          </form>
        </section>
      )}
      {scope.projects.length ? (
        <div className="entity-grid">
          {scope.projects.map((p) => (
            <AppLink
              key={p.id}
              href={scopedLink(`/app/projects/${p.id}`, scope.organizationId)}
              className="entity-card"
            >
              <div className="entity-card-top">
                <span className="entity-icon">
                  <RiFolder3Line size={22} />
                </span>
                <RiArrowRightUpLine size={18} />
              </div>
              <h3>{p.name}</h3>
              <p>API checks, execution history and environments.</p>
              <div className="entity-card-bottom">
                <span>/{p.slug}</span>
                <span>Open project →</span>
              </div>
            </AppLink>
          ))}
        </div>
      ) : (
        <EmptyState title="A fresh start">
          {scope.manage
            ? "Create a project, then add an environment and your first API test."
            : "Ask an Owner or Admin to create a project."}
        </EmptyState>
      )}
      <p className="list-note">
        Showing up to 100 projects. All results are scoped to this workspace.
      </p>
    </>
  );
}
export function ProjectSettingsPage() {
  const scope = useScope(),
    action = useAction(),
    confirm = useConfirm(),
    navigate = useNavigate();
  const project = scope.project;
  if (!project)
    return (
      <EmptyState
        title="Project unavailable"
        href={scopedLink("/app/projects", scope.organizationId)}
      >
        Choose a project you can access.
      </EmptyState>
    );
  return (
    <>
      <PageHeader
        title="Project settings"
        description="Manage the project identity. Changes apply to everyone in this workspace."
      />
      {action.notice}
      <section className="panel">
        <h3>General</h3>
        <form
          key={project.updatedAt}
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void action.run(async (): Promise<void | false> => {
              await api(
                `/projects/${project.id}`,
                "PATCH",
                { name: formValue(form, "name") },
                scope.organizationId,
              );
              scope.refresh();
            });
          }}
        >
          <fieldset disabled={!scope.manage || action.busy}>
            <Field label="Project name">
              <input
                name="name"
                defaultValue={project.name}
                required
                maxLength={120}
              />
            </Field>
            <Button type="submit" variant="primary">
              Save changes
            </Button>
          </fieldset>
        </form>
      </section>
      {scope.manage && (
        <section className="panel danger-zone">
          <h3>Delete project</h3>
          <p>Only empty projects can be deleted. This cannot be undone.</p>
          <Button
            variant="destructive"
            disabled={action.busy}
            onClick={() =>
              void action.run(async (): Promise<void | false> => {
                if (!(await confirm("Permanently delete this empty project?")))
                  return false;
                await api(
                  `/projects/${project.id}`,
                  "DELETE",
                  {},
                  scope.organizationId,
                );
                scope.refresh();
                navigate(scopedLink("/app/projects", scope.organizationId));
              })
            }
          >
            Delete project
          </Button>
        </section>
      )}
    </>
  );
}

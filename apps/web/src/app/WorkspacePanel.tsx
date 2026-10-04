import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { z } from "zod";
import {
  organizationViewSchema,
  projectViewSchema,
  environmentViewSchema,
  secretMetadataSchema,
  memberViewSchema,
  invitationViewSchema,
  variablesSchema,
  resourceIdSchema,
  authTokenSchema,
} from "@monitorx/contracts";
import { workspaceRequest as api } from "./workspace-api.js";
import { TestLibrary } from "./builder/TestLibrary.js";
import { reliabilityLink } from "./reliability/use-resource.js";

type Organization = z.infer<typeof organizationViewSchema>;
type Project = z.infer<typeof projectViewSchema>;
type Environment = z.infer<typeof environmentViewSchema>;
type Secret = z.infer<typeof secretMetadataSchema>;
type Member = z.infer<typeof memberViewSchema>;
type Invitation = z.infer<typeof invitationViewSchema>;
const items = <T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): z.infer<T>[] => z.object({ items: z.array(schema) }).parse(data).items;
const field = (form: HTMLFormElement, name: string): string =>
  String(new FormData(form).get(name) ?? "");
function NameFields(): ReactElement {
  return (
    <>
      <label>
        Name
        <input name="name" required maxLength={120} />
      </label>
      <label>
        Slug
        <input
          name="slug"
          required
          minLength={2}
          maxLength={120}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="lowercase-name"
        />
      </label>
    </>
  );
}

export function WorkspacePanel(): ReactElement {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState("");
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [pendingInvite, setPendingInvite] = useState<{
    organizationId: string;
    token: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const organization = organizations.find(
    (value) => value.id === organizationId,
  );
  const project = projects.find((value) => value.id === projectId);
  const environment = environments.find((value) => value.id === environmentId);
  const manage =
    organization?.role === "OWNER" || organization?.role === "ADMIN";
  const roles =
    organization?.role === "OWNER"
      ? ["OWNER", "ADMIN", "EDITOR", "VIEWER"]
      : ["EDITOR", "VIEWER"];

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      await work();
      setMessage("Saved or refreshed successfully.");
    } catch (error) {
      setMessage(
        error instanceof z.ZodError || error instanceof SyntaxError
          ? "Invalid data. Check the form and try again."
          : error instanceof Error
            ? error.message
            : "Request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadOrganizations(): Promise<void> {
    setOrganizations(
      items(organizationViewSchema, await api("/organizations?limit=100")),
    );
  }
  async function chooseOrganization(id: string): Promise<void> {
    setOrganizationId(id);
    setProjects([]);
    setProjectId("");
    setEnvironments([]);
    setEnvironmentId("");
    setSecrets([]);
    setMembers([]);
    setInvitations([]);
    if (!id) return;
    const latest = organizationViewSchema.parse(
      await api(`/organizations/${id}`),
    );
    setOrganizations((previous) =>
      previous.map((item) => (item.id === id ? latest : item)),
    );
    setProjects(
      items(
        projectViewSchema,
        await api("/projects?limit=100", "GET", undefined, id),
      ),
    );
    if (["OWNER", "ADMIN"].includes(latest.role)) {
      const [memberData, inviteData] = await Promise.all([
        api(`/organizations/${id}/members?limit=100`),
        api(`/organizations/${id}/invites?limit=100`),
      ]);
      setMembers(items(memberViewSchema, memberData));
      setInvitations(items(invitationViewSchema, inviteData));
    }
  }
  async function chooseProject(id: string): Promise<void> {
    setProjectId(id);
    setEnvironmentId("");
    setSecrets([]);
    setEnvironments([]);
    if (id)
      setEnvironments(
        items(
          environmentViewSchema,
          await api(
            `/projects/${id}/environments?limit=100`,
            "GET",
            undefined,
            organizationId,
          ),
        ),
      );
  }
  async function chooseEnvironment(id: string): Promise<void> {
    setEnvironmentId(id);
    setSecrets([]);
    if (id) {
      const fresh = environmentViewSchema.parse(
        await api(`/environments/${id}`, "GET", undefined, organizationId),
      );
      setEnvironments((previous) =>
        previous.map((item) => (item.id === id ? fresh : item)),
      );
      setSecrets(
        items(
          secretMetadataSchema,
          await api(
            `/environments/${id}/secrets?limit=100`,
            "GET",
            undefined,
            organizationId,
          ),
        ),
      );
    }
  }
  useEffect(() => {
    let active = true;
    void api("/organizations?limit=100")
      .then((data) => {
        if (active) setOrganizations(items(organizationViewSchema, data));
      })
      .catch(() => {
        if (active)
          setMessage("Unable to load workspaces. Sign in again or retry.");
      });
    function readInvite(): void {
      const link = new URLSearchParams(window.location.hash.slice(1)).get(
        "invitation",
      );
      if (!link) return;
      window.history.replaceState(null, "", window.location.pathname);
      const [id, token] = link.split(".");
      if (
        resourceIdSchema.safeParse(id).success &&
        authTokenSchema.safeParse(token).success
      )
        setPendingInvite({ organizationId: id!, token: token! });
      else setMessage("Invalid invitation link.");
    }
    readInvite();
    window.addEventListener("hashchange", readInvite);
    return () => {
      active = false;
      window.removeEventListener("hashchange", readInvite);
    };
  }, []);
  function submit(
    event: FormEvent<HTMLFormElement>,
    action: (form: HTMLFormElement) => Promise<void>,
  ): void {
    event.preventDefault();
    const form = event.currentTarget;
    void run(() => action(form));
  }
  return (
    <section className="workspace-panel" aria-labelledby="workspace-title">
      <h2 id="workspace-title">Workspaces and settings</h2>
      <p>
        Non-secret variables are visible to workspace members. Saved secrets are
        never revealed.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <fieldset disabled={busy}>
        {pendingInvite && (
          <div>
            <p>
              Workspace invitation ready. You must be signed in with the invited
              email.
            </p>
            <button
              onClick={() =>
                run(async () => {
                  await api(
                    `/organizations/${pendingInvite.organizationId}/invites/accept`,
                    "POST",
                    { token: pendingInvite.token },
                  );
                  setPendingInvite(undefined);
                  await loadOrganizations();
                })
              }
            >
              Accept invitation
            </button>
          </div>
        )}
        <details>
          <summary>Create a workspace</summary>
          <form
            onSubmit={(event) =>
              submit(event, async (form) => {
                const created = organizationViewSchema.parse(
                  await api("/organizations", "POST", {
                    name: field(form, "name"),
                    slug: field(form, "slug"),
                  }),
                );
                form.reset();
                await loadOrganizations();
                await chooseOrganization(created.id);
              })
            }
          >
            <NameFields />
            <button type="submit">Create workspace</button>
          </form>
        </details>
        <label>
          Workspace
          <select
            value={organizationId}
            onChange={(event) => {
              const id = event.target.value;
              void run(() => chooseOrganization(id));
            }}
          >
            <option value="">Choose workspace</option>
            {organizations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.role})
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() =>
            run(async () => {
              await loadOrganizations();
              await chooseOrganization(organizationId);
            })
          }
        >
          Refresh workspace
        </button>
        {organization && (
          <>
            <h3>Projects</h3>
            <label>
              Project
              <select
                value={projectId}
                onChange={(event) => {
                  const id = event.target.value;
                  void run(() => chooseProject(id));
                }}
              >
                <option value="">Choose project</option>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {manage && (
              <details>
                <summary>Create project</summary>
                <form
                  onSubmit={(event) =>
                    submit(event, async (form) => {
                      await api(
                        "/projects",
                        "POST",
                        {
                          name: field(form, "name"),
                          slug: field(form, "slug"),
                        },
                        organizationId,
                      );
                      form.reset();
                      await chooseOrganization(organizationId);
                    })
                  }
                >
                  <NameFields />
                  <button type="submit">Create project</button>
                </form>
              </details>
            )}
            {project && (
              <>
                {manage && (
                  <>
                    <form
                      key={project.id + project.updatedAt}
                      onSubmit={(event) =>
                        submit(event, async (form) => {
                          await api(
                            `/projects/${projectId}`,
                            "PATCH",
                            { name: field(form, "name") },
                            organizationId,
                          );
                          await chooseOrganization(organizationId);
                        })
                      }
                    >
                      <label>
                        Project name
                        <input
                          name="name"
                          defaultValue={project.name}
                          required
                          maxLength={120}
                        />
                      </label>
                      <button type="submit">Rename project</button>
                    </form>
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete this empty project? This cannot be undone.",
                          )
                        )
                          void run(async () => {
                            await api(
                              `/projects/${projectId}`,
                              "DELETE",
                              {},
                              organizationId,
                            );
                            await chooseOrganization(organizationId);
                          });
                      }}
                    >
                      Delete project
                    </button>
                  </>
                )}
                <h3>Environments</h3>
                <label>
                  Environment
                  <select
                    value={environmentId}
                    onChange={(event) => {
                      const id = event.target.value;
                      void run(() => chooseEnvironment(id));
                    }}
                  >
                    <option value="">Choose environment</option>
                    {environments.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                {manage && (
                  <details>
                    <summary>Create environment</summary>
                    <form
                      onSubmit={(event) =>
                        submit(event, async (form) => {
                          await api(
                            `/projects/${projectId}/environments`,
                            "POST",
                            {
                              name: field(form, "name"),
                              slug: field(form, "slug"),
                              variables: {},
                            },
                            organizationId,
                          );
                          form.reset();
                          await chooseProject(projectId);
                        })
                      }
                    >
                      <NameFields />
                      <button type="submit">Create environment</button>
                    </form>
                  </details>
                )}
              </>
            )}
            {project && (
              <p>
                <a
                  href={reliabilityLink("projects", project.id, organizationId)}
                >
                  Open project dashboard and history
                </a>
              </p>
            )}
            {project && (
              <TestLibrary
                key={`${organizationId}-${project.id}-${organization.role}`}
                organizationId={organizationId}
                projectId={project.id}
                role={organization.role}
              />
            )}
            {environment && (
              <>
                <h3>Variables and secrets</h3>
                <form
                  key={environment.id + environment.updatedAt}
                  onSubmit={(event) =>
                    submit(event, async (form) => {
                      const variables: unknown = JSON.parse(
                        field(form, "variables"),
                      );
                      await api(
                        `/environments/${environmentId}`,
                        "PATCH",
                        {
                          name: field(form, "name"),
                          variables: variablesSchema.parse(variables),
                        },
                        organizationId,
                      );
                      await chooseEnvironment(environmentId);
                    })
                  }
                >
                  <label>
                    Environment name
                    <input
                      name="name"
                      defaultValue={environment.name}
                      readOnly={!manage}
                      required
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Non-secret variables (JSON)
                    <textarea
                      name="variables"
                      rows={5}
                      readOnly={!manage}
                      defaultValue={JSON.stringify(
                        environment.variables,
                        null,
                        2,
                      )}
                    />
                  </label>
                  {manage && <button type="submit">Save environment</button>}
                </form>
                {manage && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this environment and all its secrets? This cannot be undone.",
                        )
                      )
                        void run(async () => {
                          await api(
                            `/environments/${environmentId}`,
                            "DELETE",
                            {},
                            organizationId,
                          );
                          await chooseProject(projectId);
                        });
                    }}
                  >
                    Delete environment
                  </button>
                )}
                {manage && (
                  <form
                    onSubmit={(event) =>
                      submit(event, async (form) => {
                        const key = field(form, "key");
                        if (
                          secrets.some((secret) => secret.key === key) &&
                          !window.confirm(
                            `Replace ${key}? Its previous value cannot be recovered from the application.`,
                          )
                        )
                          return;
                        const value = field(form, "value");
                        form.reset();
                        await api(
                          `/environments/${environmentId}/secrets/${encodeURIComponent(key)}`,
                          "PUT",
                          { value },
                          organizationId,
                        );
                        await chooseEnvironment(environmentId);
                      })
                    }
                  >
                    <label>
                      Secret name
                      <input
                        name="key"
                        required
                        pattern="[A-Z][A-Z0-9_]*"
                        maxLength={120}
                        placeholder="API_TOKEN"
                      />
                    </label>
                    <label>
                      New secret value (write-only)
                      <input
                        name="value"
                        type="password"
                        autoComplete="new-password"
                        required
                        maxLength={10000}
                      />
                    </label>
                    <button type="submit">Save secret</button>
                  </form>
                )}
                <ul>
                  {secrets.map((secret) => (
                    <li key={secret.id}>
                      {secret.key}: {secret.maskedValue} (key version{" "}
                      {secret.keyVersion}){" "}
                      {manage && (
                        <>
                          <button
                            onClick={() =>
                              run(async () => {
                                await api(
                                  `/environments/${environmentId}/secrets/${secret.key}/rotate`,
                                  "POST",
                                  {},
                                  organizationId,
                                );
                                await chooseEnvironment(environmentId);
                              })
                            }
                          >
                            Rotate {secret.key}
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete ${secret.key}?`))
                                void run(async () => {
                                  await api(
                                    `/environments/${environmentId}/secrets/${secret.key}`,
                                    "DELETE",
                                    {},
                                    organizationId,
                                  );
                                  await chooseEnvironment(environmentId);
                                });
                            }}
                          >
                            Delete {secret.key}
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {manage && (
              <>
                <h3>Team and invitations</h3>
                <form
                  onSubmit={(event) =>
                    submit(event, async (form) => {
                      await api(
                        `/organizations/${organizationId}/invites`,
                        "POST",
                        {
                          email: field(form, "email"),
                          role: field(form, "role"),
                        },
                      );
                      form.reset();
                      await chooseOrganization(organizationId);
                    })
                  }
                >
                  <label>
                    Invitation email
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    Invitation role
                    <select name="role" defaultValue="VIEWER">
                      {roles.map((role) => (
                        <option key={role}>{role}</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit">Send invitation</button>
                </form>
                <ul>
                  {members.map((member) => (
                    <li key={member.id}>
                      {member.user.email} — {member.role} ({member.status})
                      {(organization.role === "OWNER" ||
                        ["EDITOR", "VIEWER"].includes(member.role)) &&
                        member.status === "ACTIVE" && (
                          <form
                            onSubmit={(event) =>
                              submit(event, async (form) => {
                                await api(
                                  `/organizations/${organizationId}/members/${member.userId}`,
                                  "PATCH",
                                  { role: field(form, "role") },
                                );
                                await chooseOrganization(organizationId);
                              })
                            }
                          >
                            <label>
                              Role for {member.user.email}
                              <select
                                name="role"
                                defaultValue={member.role}
                                key={member.role}
                              >
                                {roles.map((role) => (
                                  <option key={role}>{role}</option>
                                ))}
                              </select>
                            </label>
                            <button type="submit">Change role</button>
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Remove ${member.user.email} from this workspace?`,
                                  )
                                )
                                  void run(async () => {
                                    await api(
                                      `/organizations/${organizationId}/members/${member.userId}`,
                                      "DELETE",
                                      {},
                                    );
                                    await chooseOrganization(organizationId);
                                  });
                              }}
                            >
                              Remove member
                            </button>
                          </form>
                        )}
                    </li>
                  ))}
                </ul>
                <ul>
                  {invitations.map((invite) => (
                    <li key={invite.id}>
                      {invite.email} — {invite.role}:{" "}
                      {invite.acceptedAt
                        ? "accepted"
                        : invite.revokedAt
                          ? "revoked"
                          : new Date(invite.expiresAt) <= new Date()
                            ? "expired"
                            : "pending"}{" "}
                      {!invite.acceptedAt &&
                        !invite.revokedAt &&
                        (organization.role === "OWNER" ||
                          ["EDITOR", "VIEWER"].includes(invite.role)) && (
                          <button
                            onClick={() => {
                              if (window.confirm("Revoke this invitation?"))
                                void run(async () => {
                                  await api(
                                    `/organizations/${organizationId}/invites/${invite.id}`,
                                    "DELETE",
                                    {},
                                  );
                                  await chooseOrganization(organizationId);
                                });
                            }}
                          >
                            Revoke invitation
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <p>
          Lists show up to 100 entries. The API supports page and limit
          parameters for larger workspaces.
        </p>
      </fieldset>
    </section>
  );
}

import { useState } from "react";
import { z } from "zod";
import {
  secretMetadataSchema,
  variablesSchema,
  environmentViewSchema,
} from "@monitorx/contracts";
import { Button, Field, useConfirm } from "@monitorx/ui";
import { RiAddLine, RiKey2Line } from "@remixicon/react";
import { useScope } from "../scope.js";
import { useResource } from "../reliability/use-resource.js";
import { workspaceRequest as api } from "../workspace-api.js";
import { environmentPage } from "./TestPages.js";
import {
  PageHeader,
  Loading,
  EmptyState,
  NameFields,
  formValue,
  useAction,
} from "./shared.js";
const secretsPage = z.object({ items: z.array(secretMetadataSchema) });
export function EnvironmentsPage() {
  const scope = useScope(),
    action = useAction();
  const [selected, setSelected] = useState(""),
    [create, setCreate] = useState(false);
  const envs = useResource(
    `/projects/${scope.projectId}/environments?limit=100`,
    scope.organizationId,
    environmentPage,
  );
  return (
    <>
      <PageHeader
        title="Environments"
        description="Separate configuration from requests. Share variables; keep credentials encrypted."
        action={
          scope.manage && (
            <Button variant="primary" onClick={() => setCreate((v) => !v)}>
              <RiAddLine size={18} />
              New environment
            </Button>
          )
        }
      />
      {action.notice}
      {create && (
        <section className="panel">
          <h3>Create environment</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void action.run(async (): Promise<void | false> => {
                const env = environmentViewSchema.parse(
                  await api(
                    `/projects/${scope.projectId}/environments`,
                    "POST",
                    {
                      name: formValue(form, "name"),
                      slug: formValue(form, "slug"),
                      variables: {},
                    },
                    scope.organizationId,
                  ),
                );
                setSelected(env.id);
                setCreate(false);
                envs.reload();
              });
            }}
          >
            <fieldset disabled={action.busy}>
              <NameFields />
              <Button type="submit" variant="primary">
                Create environment
              </Button>
            </fieldset>
          </form>
        </section>
      )}
      {!envs.data ? (
        <Loading error={envs.error} reload={envs.reload} />
      ) : !envs.data.items.length ? (
        <EmptyState title="Create your first environment">
          Environments hold public variables and encrypted credentials used by
          your checks.
        </EmptyState>
      ) : (
        <div className="settings-layout">
          <nav className="settings-list" aria-label="Environments">
            {envs.data.items.map((e) => (
              <Button
                className={e.id === selected ? "selected" : ""}
                key={e.id}
                onClick={() => setSelected(e.id)}
              >
                <RiKey2Line size={18} />
                <span>
                  {e.name}
                  <small>/{e.slug}</small>
                </span>
              </Button>
            ))}
          </nav>
          {selected ? (
            <EnvironmentDetail
              key={selected}
              id={selected}
              onDeleted={() => {
                setSelected("");
                envs.reload();
              }}
              onUpdated={envs.reload}
            />
          ) : (
            <EmptyState title="Choose an environment">
              Select one on the left to manage its variables and secrets.
            </EmptyState>
          )}
        </div>
      )}
    </>
  );
}
function EnvironmentDetail({
  id,
  onDeleted,
  onUpdated,
}: {
  id: string;
  onDeleted: () => void;
  onUpdated: () => void;
}) {
  const scope = useScope(),
    action = useAction(),
    confirm = useConfirm();
  const env = useResource(
      `/environments/${id}`,
      scope.organizationId,
      environmentViewSchema,
    ),
    secrets = useResource(
      `/environments/${id}/secrets?limit=100`,
      scope.organizationId,
      secretsPage,
    );
  if (!env.data) return <Loading error={env.error} reload={env.reload} />;
  return (
    <div>
      {action.notice}
      <section className="panel">
        <div className="section-heading">
          <h3>{env.data.name}</h3>
          <span className="role-badge">ENVIRONMENT</span>
        </div>
        <form
          key={env.data.updatedAt}
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void action.run(async (): Promise<void | false> => {
              await api(
                `/environments/${id}`,
                "PATCH",
                {
                  name: formValue(form, "name"),
                  variables: variablesSchema.parse(
                    JSON.parse(formValue(form, "variables")),
                  ),
                },
                scope.organizationId,
              );
              env.reload();
              onUpdated();
            });
          }}
        >
          <fieldset disabled={action.busy}>
            <Field label="Environment name">
              <input
                name="name"
                defaultValue={env.data.name}
                readOnly={!scope.manage}
                required
                maxLength={120}
              />
            </Field>
            <Field
              label="Non-secret variables (JSON)"
              hint="Visible to workspace members. Never put passwords or tokens here."
            >
              <textarea
                name="variables"
                className="code-input"
                rows={7}
                defaultValue={JSON.stringify(env.data.variables, null, 2)}
                readOnly={!scope.manage}
              />
            </Field>
            {scope.manage && (
              <Button type="submit" variant="primary">
                Save environment
              </Button>
            )}
          </fieldset>
        </form>
      </section>
      <section className="panel">
        <h3>Encrypted secrets</h3>
        <p className="muted">
          Write-only values. Reference a key using{" "}
          <code>{"{{SECRET_NAME}}"}</code>; saved values are never revealed.
        </p>
        {scope.manage && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void action.run(async (): Promise<void | false> => {
                const key = formValue(form, "key");
                if (
                  secrets.data?.items.some((s) => s.key === key) &&
                  !(await confirm(
                    `Replace ${key}? The previous value cannot be recovered.`,
                  ))
                )
                  return false;
                await api(
                  `/environments/${id}/secrets/${encodeURIComponent(key)}`,
                  "PUT",
                  { value: formValue(form, "value") },
                  scope.organizationId,
                );
                form.reset();
                secrets.reload();
              });
            }}
          >
            <fieldset disabled={action.busy}>
              <div className="form-grid">
                <Field label="Secret key">
                  <input
                    name="key"
                    required
                    pattern="[A-Z][A-Z0-9_]{0,119}"
                    placeholder="API_TOKEN"
                  />
                </Field>
                <Field label="Secret value">
                  <input
                    name="value"
                    type="password"
                    required
                    maxLength={10000}
                    autoComplete="new-password"
                  />
                </Field>
              </div>
              <Button type="submit">Save secret</Button>
            </fieldset>
          </form>
        )}
        {!secrets.data ? (
          <Loading error={secrets.error} reload={secrets.reload} />
        ) : secrets.data.items.length ? (
          <ul className="record-list">
            {secrets.data.items.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.key}</strong>
                  <small>
                    {s.maskedValue} · key version {s.keyVersion}
                  </small>
                </div>
                {scope.manage && (
                  <div className="row-actions">
                    <Button
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async (): Promise<void | false> => {
                          await api(
                            `/environments/${id}/secrets/${s.key}/rotate`,
                            "POST",
                            {},
                            scope.organizationId,
                          );
                          secrets.reload();
                        })
                      }
                    >
                      Rotate
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async (): Promise<void | false> => {
                          if (
                            !(await confirm(
                              `Delete secret ${s.key}? Tests using it may fail.`,
                            ))
                          )
                            return false;
                          await api(
                            `/environments/${id}/secrets/${s.key}`,
                            "DELETE",
                            {},
                            scope.organizationId,
                          );
                          secrets.reload();
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="list-note">No secrets saved.</p>
        )}
      </section>
      {scope.manage && (
        <section className="panel danger-zone">
          <h3>Delete environment</h3>
          <p>Referenced environments cannot be deleted.</p>
          <Button
            variant="destructive"
            disabled={action.busy}
            onClick={() =>
              void action.run(async (): Promise<void | false> => {
                if (
                  !(await confirm(
                    "Delete this environment and all its secrets?",
                  ))
                )
                  return false;
                await api(
                  `/environments/${id}`,
                  "DELETE",
                  {},
                  scope.organizationId,
                );
                onDeleted();
              })
            }
          >
            Delete environment
          </Button>
        </section>
      )}
    </div>
  );
}

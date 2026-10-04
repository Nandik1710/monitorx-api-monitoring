import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import {
  collectionViewSchema,
  environmentViewSchema,
  testViewSchema,
} from "@monitorx/contracts";
import { Button, Field, useConfirm } from "@monitorx/ui";
import {
  RiAddLine,
  RiFolderOpenLine,
  RiArrowRightUpLine,
  RiEditLine,
} from "@remixicon/react";
import { useScope } from "../scope.js";
import { AppLink, scopedLink } from "../navigation.js";
import { workspaceRequest as api } from "../workspace-api.js";
import { useResource } from "../reliability/use-resource.js";
import {
  PageHeader,
  EmptyState,
  Loading,
  formValue,
  useAction,
} from "./shared.js";
import { RunControls } from "../builder/RunControls.js";
import { TestEditor } from "../builder/TestEditor.js";
import { useUnsavedChanges } from "../use-unsaved-changes.js";
const collectionPage = z.object({
  items: z.array(collectionViewSchema),
  total: z.number(),
});
const testPage = z.object({
  items: z.array(testViewSchema),
  total: z.number(),
});
export const environmentPage = z.object({
  items: z.array(environmentViewSchema),
});
export function useResolvedProject(projectId: string | undefined) {
  const [query, setQuery] = useSearchParams();
  const current = query.get("projectId");
  useEffect(() => {
    if (projectId && current !== projectId)
      setQuery(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("projectId", projectId);
          return next;
        },
        { replace: true },
      );
  }, [projectId, current, setQuery]);
}
export function CollectionsPage() {
  const scope = useScope(),
    navigate = useNavigate(),
    action = useAction();
  const [page, setPage] = useState(1),
    [create, setCreate] = useState(false);
  const { data, error, reload } = useResource(
    `/collections?projectId=${scope.projectId}&page=${page}&limit=20`,
    scope.organizationId,
    collectionPage,
  );
  return (
    <>
      <PageHeader
        eyebrow="TEST LIBRARY"
        title="Collections & tests"
        description="Reusable checks, grouped by service. Saving a definition never sends a request."
        action={
          scope.organization?.role !== "VIEWER" && (
            <Button variant="primary" onClick={() => setCreate((v) => !v)}>
              <RiAddLine size={18} />
              New collection
            </Button>
          )
        }
      />
      {action.notice}
      {create && (
        <section className="panel">
          <h3>Create collection</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void action.run(async (): Promise<void | false> => {
                const c = collectionViewSchema.parse(
                  await api(
                    "/collections",
                    "POST",
                    {
                      projectId: scope.projectId,
                      name: formValue(form, "name"),
                      description: formValue(form, "description"),
                    },
                    scope.organizationId,
                  ),
                );
                navigate(
                  scopedLink(
                    `/app/collections/${c.id}`,
                    scope.organizationId,
                    scope.projectId,
                  ),
                );
              });
            }}
          >
            <fieldset disabled={action.busy}>
              <Field label="Collection name">
                <input name="name" required maxLength={120} />
              </Field>
              <Field label="Description">
                <textarea name="description" maxLength={5000} rows={2} />
              </Field>
              <Button type="submit" variant="primary">
                Create collection
              </Button>
            </fieldset>
          </form>
        </section>
      )}
      {!data ? (
        <Loading error={error} reload={reload} />
      ) : (
        <>
          {data.items.length ? (
            <div className="entity-grid">
              {data.items.map((c) => (
                <AppLink
                  key={c.id}
                  className="entity-card"
                  href={scopedLink(
                    `/app/collections/${c.id}`,
                    scope.organizationId,
                    scope.projectId,
                  )}
                >
                  <div className="entity-card-top">
                    <span className="entity-icon">
                      <RiFolderOpenLine size={22} />
                    </span>
                    <RiArrowRightUpLine size={18} />
                  </div>
                  <h3>{c.name}</h3>
                  <p>
                    {c.description || "A collection of reusable API checks."}
                  </p>
                  <div className="entity-card-bottom">
                    <span>View tests</span>
                    <span>→</span>
                  </div>
                </AppLink>
              ))}
            </div>
          ) : (
            <EmptyState title="Your first collection starts here">
              Group checks by service, feature or workflow.
            </EmptyState>
          )}
          <Pagination page={page} total={data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
export function Pagination({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total} results · page {page}
      </span>
      <div>
        <Button disabled={page === 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button disabled={page * 20 >= total} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
export function CollectionPage() {
  const { id = "" } = useParams(),
    scope = useScope(),
    navigate = useNavigate(),
    action = useAction(),
    confirm = useConfirm();
  const [page, setPage] = useState(1),
    [settings, setSettings] = useState(false);
  const collection = useResource(
    `/collections/${id}`,
    scope.organizationId,
    collectionViewSchema,
  );
  useResolvedProject(collection.data?.projectId);
  const tests = useResource(
    `/tests?collectionId=${id}&limit=20&page=${page}`,
    scope.organizationId,
    testPage,
  );
  const envs = useResource(
    collection.data
      ? `/projects/${collection.data.projectId}/environments?limit=100`
      : null,
    scope.organizationId,
    environmentPage,
  );
  const readOnly = scope.organization?.role === "VIEWER",
    link = (path: string) =>
      scopedLink(path, scope.organizationId, collection.data?.projectId);
  if (!collection.data)
    return <Loading error={collection.error} reload={collection.reload} />;
  return (
    <>
      <PageHeader
        eyebrow="COLLECTION"
        title={collection.data.name}
        description={
          collection.data.description ||
          "Define, run and inspect your API checks."
        }
        action={
          <>
            <Button onClick={() => setSettings((v) => !v)}>
              <RiEditLine size={16} />
              Settings
            </Button>
            {!readOnly && (
              <AppLink
                className="ui-button button-primary"
                href={link(`/app/collections/${id}/new-test`)}
              >
                <RiAddLine size={18} />
                New API test
              </AppLink>
            )}
          </>
        }
      />
      <div className="page-tabs">
        <AppLink href={link(`/app/collections/${id}`)} aria-current="page">
          Tests
        </AppLink>
        <AppLink href={link(`/app/collections/${id}/overview`)}>
          Overview
        </AppLink>
        <AppLink href={link(`/app/collections/${id}/history`)}>History</AppLink>
      </div>
      {action.notice}
      {settings && (
        <section className="panel">
          <h3>Collection settings</h3>
          <form
            key={collection.data.updatedAt}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void action.run(async (): Promise<void | false> => {
                await api(
                  `/collections/${id}`,
                  "PATCH",
                  {
                    name: formValue(form, "name"),
                    description: formValue(form, "description"),
                  },
                  scope.organizationId,
                );
                collection.reload();
              });
            }}
          >
            <fieldset disabled={readOnly || action.busy}>
              <Field label="Collection name">
                <input
                  name="name"
                  defaultValue={collection.data.name}
                  required
                  maxLength={120}
                />
              </Field>
              <Field label="Description">
                <textarea
                  name="description"
                  defaultValue={collection.data.description ?? ""}
                  maxLength={5000}
                />
              </Field>
              <div className="builder-actions">
                <Button type="submit" variant="primary">
                  Save collection
                </Button>
                <Button
                  variant="destructive"
                  onClick={() =>
                    void action.run(async (): Promise<void | false> => {
                      if (
                        !(await confirm(
                          "Delete this empty collection? This cannot be undone.",
                        ))
                      )
                        return false;
                      await api(
                        `/collections/${id}`,
                        "DELETE",
                        {},
                        scope.organizationId,
                      );
                      navigate(
                        link(
                          `/app/projects/${collection.data!.projectId}/tests`,
                        ),
                      );
                    })
                  }
                >
                  Delete collection
                </Button>
              </div>
            </fieldset>
          </form>
        </section>
      )}
      <details className="panel run-drawer">
        <summary>
          Run collection{" "}
          <span>Execute saved tests with bounded parallelism</span>
        </summary>
        {envs.data ? (
          <RunControls
            id={id}
            kind="collections"
            organizationId={scope.organizationId}
            environments={envs.data.items}
            readOnly={readOnly}
          />
        ) : (
          <Loading error={envs.error} reload={envs.reload} />
        )}
      </details>
      {!tests.data ? (
        <Loading error={tests.error} reload={tests.reload} />
      ) : (
        <>
          {tests.data.items.length ? (
            <div className="table-scroll panel">
              <table>
                <caption>Saved API tests</caption>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Method</th>
                    <th>State</th>
                    <th>Revision</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.data.items.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <AppLink
                          className="table-title"
                          href={link(`/app/tests/${t.id}/edit`)}
                        >
                          {t.name}
                        </AppLink>
                        <small>{t.tags.join(" · ") || "No tags"}</small>
                      </td>
                      <td>
                        <span className="method-badge">{t.method}</span>
                      </td>
                      <td>
                        <span className="role-badge">
                          {t.enabled ? "Enabled" : "Draft"}
                        </span>
                      </td>
                      <td>v{t.revision}</td>
                      <td>
                        <div className="row-actions">
                          <AppLink href={link(`/app/tests/${t.id}/edit`)}>
                            {readOnly ? "View" : "Edit"}
                          </AppLink>
                          <AppLink href={link(`/app/tests/${t.id}`)}>
                            Results
                          </AppLink>
                          {!readOnly && (
                            <Button
                              variant="ghost"
                              disabled={action.busy}
                              onClick={() =>
                                void action.run(
                                  async (): Promise<void | false> => {
                                    if (
                                      !(await confirm(
                                        `Delete ${t.name}? Its execution history will also be removed.`,
                                      ))
                                    )
                                      return false;
                                    await api(
                                      `/tests/${t.id}`,
                                      "DELETE",
                                      { expectedRevision: t.revision },
                                      scope.organizationId,
                                    );
                                    tests.reload();
                                  },
                                )
                              }
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No tests in this collection">
              Create a saved request and add assertions to define what a healthy
              response looks like.
            </EmptyState>
          )}
          <Pagination page={page} total={tests.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
export function TestEditorPage({ create = false }: { create?: boolean }) {
  const setDirty = useUnsavedChanges();
  const { id = "" } = useParams(),
    scope = useScope(),
    navigate = useNavigate();
  const test = useResource(
      create ? null : `/tests/${id}`,
      scope.organizationId,
      testViewSchema,
    ),
    collection = useResource(
      create ? `/collections/${id}` : null,
      scope.organizationId,
      collectionViewSchema,
    );
  const projectId = create ? collection.data?.projectId : test.data?.projectId,
    collectionId = create ? id : test.data?.collectionId;
  useResolvedProject(projectId);
  const envs = useResource(
    projectId ? `/projects/${projectId}/environments?limit=100` : null,
    scope.organizationId,
    environmentPage,
  );
  if (!projectId || !collectionId || !envs.data)
    return (
      <Loading
        error={test.error || collection.error || envs.error}
        reload={() => {
          test.reload();
          collection.reload();
          envs.reload();
        }}
      />
    );
  return (
    <>
      <PageHeader
        eyebrow="REQUEST BUILDER"
        title={create ? "Create an API test" : (test.data?.name ?? "API test")}
        description="Edit the saved definition. Requests execute only when you explicitly run a test."
        action={
          <AppLink
            className="ui-button"
            href={scopedLink(
              `/app/collections/${collectionId}`,
              scope.organizationId,
              projectId,
            )}
          >
            ← Collection
          </AppLink>
        }
      />
      <TestEditor
        onDirtyChange={setDirty}
        key={test.data ? `${test.data.id}-${test.data.revision}` : id}
        initial={test.data}
        organizationId={scope.organizationId}
        projectId={projectId}
        collectionId={collectionId}
        environments={envs.data.items}
        readOnly={scope.organization?.role === "VIEWER"}
        onSaved={async () => {
          navigate(
            scopedLink(
              `/app/collections/${collectionId}`,
              scope.organizationId,
              projectId,
            ),
          );
        }}
        onCancel={() =>
          navigate(
            scopedLink(
              `/app/collections/${collectionId}`,
              scope.organizationId,
              projectId,
            ),
          )
        }
      />
    </>
  );
}

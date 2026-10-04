import { useEffect, useState, type ReactElement, type FormEvent } from "react";
import { z } from "zod";
import {
  collectionViewSchema,
  environmentViewSchema,
  testViewSchema,
  type TestView,
} from "@monitorx/contracts";
import { Button, Field, Notice } from "@monitorx/ui";
import { workspaceRequest as api } from "../workspace-api.js";
import { TestEditor } from "./TestEditor.js";
import { RunControls } from "./RunControls.js";
import { reliabilityLink } from "../reliability/use-resource.js";

type Collection = z.infer<typeof collectionViewSchema>;
const collectionsPage = z.object({
  items: z.array(collectionViewSchema),
  total: z.number(),
});
const testsPage = z.object({
  items: z.array(testViewSchema),
  total: z.number(),
});
export function TestLibrary({
  organizationId,
  projectId,
  role,
}: {
  organizationId: string;
  projectId: string;
  role: string;
}): ReactElement {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [environments, setEnvironments] = useState<
    z.infer<typeof environmentViewSchema>[]
  >([]);
  const [tests, setTests] = useState<TestView[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<TestView | "new">();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const readOnly = role === "VIEWER";
  const selected = collections.find((c) => c.id === collectionId);
  async function loadCollections(nextPage = collectionPage): Promise<void> {
    const data = collectionsPage.parse(
      await api(
        `/collections?projectId=${projectId}&page=${nextPage}&limit=20`,
        "GET",
        undefined,
        organizationId,
      ),
    );
    setCollections(data.items);
    setCollectionTotal(data.total);
    setCollectionPage(nextPage);
  }
  async function loadTests(id = collectionId, nextPage = page): Promise<void> {
    if (!id) {
      setTests([]);
      setTotal(0);
      return;
    }
    const data = testsPage.parse(
      await api(
        `/tests?collectionId=${id}&page=${nextPage}&limit=20`,
        "GET",
        undefined,
        organizationId,
      ),
    );
    setTests(data.items);
    setTotal(data.total);
    setPage(nextPage);
  }
  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      await work();
      setMessage("Saved or refreshed successfully.");
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof z.ZodError
          ? "Unable to read this definition. Check its configuration or reload."
          : error instanceof Error
            ? error.message
            : "Request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    void Promise.all([
      api(
        `/collections?projectId=${projectId}&limit=20`,
        "GET",
        undefined,
        organizationId,
      ),
      api(
        `/projects/${projectId}/environments?limit=100`,
        "GET",
        undefined,
        organizationId,
      ),
    ])
      .then(([raw, env]) => {
        if (!active) return;
        const data = collectionsPage.parse(raw);
        setCollections(data.items);
        setCollectionTotal(data.total);
        setEnvironments(
          z.object({ items: z.array(environmentViewSchema) }).parse(env).items,
        );
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setMessage(
            "Unable to load the test library. Refresh the workspace or sign in again.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [organizationId, projectId]);
  function submitCollection(
    event: FormEvent<HTMLFormElement>,
    edit = false,
  ): void {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      await api(
        edit ? `/collections/${collectionId}` : "/collections",
        edit ? "PATCH" : "POST",
        {
          ...(!edit ? { projectId } : {}),
          name: String(data.get("name") ?? ""),
          description: String(data.get("description") ?? ""),
        },
        organizationId,
      );
      if (!edit) form.reset();
      await loadCollections();
    });
  }
  return (
    <section className="test-library" aria-labelledby="library-title">
      <h2 id="library-title">Collections and API tests</h2>
      <p>
        Define reusable checks here. Saving does not send a request; use Run now
        explicitly.
      </p>
      {message && <Notice error={failed}>{message}</Notice>}
      <fieldset disabled={busy || editing !== undefined}>
        {!readOnly && (
          <details>
            <summary>Create collection</summary>
            <form onSubmit={(e) => submitCollection(e)}>
              <Field label="Collection name">
                <input name="name" required maxLength={120} />
              </Field>
              <Field label="Collection description">
                <textarea name="description" maxLength={5000} />
              </Field>
              <Button type="submit">Create collection</Button>
            </form>
          </details>
        )}
        <Field label="Collection">
          <select
            value={collectionId}
            onChange={(e) => {
              const id = e.target.value;
              setCollectionId(id);
              setTests([]);
              setTotal(0);
              void run(() => loadTests(id, 1));
            }}
          >
            <option value="">Choose collection</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="builder-actions">
          <Button
            disabled={collectionPage <= 1}
            onClick={() =>
              run(async () => {
                setCollectionId("");
                setTests([]);
                await loadCollections(collectionPage - 1);
              })
            }
          >
            Previous collections
          </Button>
          <span>
            Collections page {collectionPage}; {collectionTotal} total
          </span>
          <Button
            disabled={collectionPage * 20 >= collectionTotal}
            onClick={() =>
              run(async () => {
                setCollectionId("");
                setTests([]);
                await loadCollections(collectionPage + 1);
              })
            }
          >
            Next collections
          </Button>
          <Button
            onClick={() =>
              run(async () => {
                await loadCollections();
                await loadTests();
                setEnvironments(
                  z
                    .object({ items: z.array(environmentViewSchema) })
                    .parse(
                      await api(
                        `/projects/${projectId}/environments?limit=100`,
                        "GET",
                        undefined,
                        organizationId,
                      ),
                    ).items,
                );
              })
            }
          >
            Refresh library
          </Button>
        </div>
        {selected && (
          <>
            <p>
              <a
                href={reliabilityLink(
                  "collections",
                  selected.id,
                  organizationId,
                )}
              >
                Open collection dashboard and history
              </a>
            </p>
            <RunControls
              key={selected.id}
              id={selected.id}
              kind="collections"
              organizationId={organizationId}
              environments={environments}
              readOnly={readOnly}
            />
            {!readOnly && (
              <details>
                <summary>Edit collection</summary>
                <form
                  key={selected.id + selected.updatedAt}
                  onSubmit={(e) => submitCollection(e, true)}
                >
                  <Field label="Updated collection name">
                    <input
                      name="name"
                      defaultValue={selected.name}
                      required
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Updated description">
                    <textarea
                      name="description"
                      defaultValue={selected.description ?? ""}
                      maxLength={5000}
                    />
                  </Field>
                  <Button type="submit">Save collection</Button>
                </form>
                <Button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Delete this collection? It must be empty.",
                      )
                    )
                      void run(async () => {
                        await api(
                          `/collections/${collectionId}`,
                          "DELETE",
                          {},
                          organizationId,
                        );
                        setCollectionId("");
                        setTests([]);
                        await loadCollections();
                      });
                  }}
                >
                  Delete collection
                </Button>
              </details>
            )}
            <p>{selected.description}</p>
            {!readOnly && (
              <Button onClick={() => setEditing("new")}>New API test</Button>
            )}
            {tests.length === 0 ? (
              <p>No tests on this page. Create your first reusable check.</p>
            ) : (
              <ul className="test-list">
                {tests.map((test) => (
                  <li key={test.id}>
                    <div>
                      <strong>{test.name}</strong>
                      <span>
                        {test.method} ·{" "}
                        {test.enabled ? "Enabled" : "Disabled draft"} · revision{" "}
                        {test.revision}
                      </span>
                    </div>
                    <Button onClick={() => setEditing(test)}>
                      {readOnly ? "View" : "Edit"} {test.name}
                    </Button>
                    {!readOnly && (
                      <Button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete ${test.name}? This cannot be undone.`,
                            )
                          )
                            void run(async () => {
                              await api(
                                `/tests/${test.id}`,
                                "DELETE",
                                { expectedRevision: test.revision },
                                organizationId,
                              );
                              await loadTests();
                            });
                        }}
                      >
                        Delete {test.name}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="builder-actions">
              <Button
                disabled={page <= 1}
                onClick={() => run(() => loadTests(collectionId, page - 1))}
              >
                Previous tests
              </Button>
              <span>
                Tests page {page}; {total} total
              </span>
              <Button
                disabled={page * 20 >= total}
                onClick={() => run(() => loadTests(collectionId, page + 1))}
              >
                Next tests
              </Button>
            </div>
          </>
        )}
      </fieldset>
      {editing && (
        <TestEditor
          key={editing === "new" ? "new" : `${editing.id}-${editing.revision}`}
          initial={editing === "new" ? undefined : editing}
          organizationId={organizationId}
          projectId={projectId}
          collectionId={collectionId}
          environments={environments}
          readOnly={readOnly}
          onCancel={() => setEditing(undefined)}
          onSaved={async () => {
            await loadTests(collectionId, 1);
            setEditing(undefined);
            setFailed(false);
            setMessage("Test saved. No request was sent.");
          }}
        />
      )}
    </section>
  );
}

import { useState, type ReactElement } from "react";
import { z } from "zod";
import {
  apiTestCreateSchema,
  apiTestFieldsSchema,
  definitionErrors,
  previewViewSchema,
  STANDARD_METHODS,
  type TestDefinition,
  type TestView,
} from "@monitorx/contracts";
import { Button, Field, Notice, Tabs } from "@monitorx/ui";
import { workspaceRequest as api } from "../workspace-api.js";
import { RowsEditor } from "./RowsEditor.js";
import { AssertionsEditor } from "./AssertionsEditor.js";
import { RunControls } from "./RunControls.js";
import { SchedulePanel } from "./SchedulePanel.js";
import { History } from "../reliability/History.js";

type EnvironmentOption = { id: string; name: string };
const tabs = [
  "Request",
  "Body",
  "Assertions",
  "Environment",
  "Schedule",
  "History",
] as const;
export function TestEditor({
  initial,
  projectId,
  collectionId,
  organizationId,
  environments,
  readOnly,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  initial?: TestView;
  projectId: string;
  collectionId: string;
  organizationId: string;
  environments: EnvironmentOption[];
  readOnly: boolean;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactElement {
  const [draft, setDraft] = useState<TestDefinition>(() =>
    initial
      ? apiTestFieldsSchema.parse(
          Object.fromEntries(
            Object.keys(apiTestFieldsSchema.shape).map((key) => [
              key,
              initial[key as keyof TestView],
            ]),
          ),
        )
      : apiTestFieldsSchema.parse({
          projectId,
          collectionId,
          name: "New check",
          method: "GET",
          urlTemplate: "https://example.test/health",
        }),
  );
  const [tab, setTab] = useState<string>("Request");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<z.infer<typeof previewViewSchema>>();
  const change = (patch: Partial<TestDefinition>) => {
    onDirtyChange?.(true);
    setDraft((value) => ({ ...value, ...patch }));
    setPreview(undefined);
  };
  const doWork = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof z.ZodError
          ? definitionErrors(cause)
          : cause instanceof Error
            ? cause.message
            : "Unable to save the test.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    doWork(async () => {
      const valid = apiTestCreateSchema.parse(draft);
      if (initial) {
        const { projectId: ignored, ...patch } = valid;
        void ignored;
        await api(
          `/tests/${initial.id}`,
          "PATCH",
          { ...patch, expectedRevision: initial.revision },
          organizationId,
        );
      } else await api("/tests", "POST", valid, organizationId);
      onDirtyChange?.(false);
      await onSaved();
    });
  const auth = draft.authConfig;
  return (
    <section className="test-editor" aria-label="API test editor">
      <h3>{initial ? "Edit API test" : "New API test"}</h3>
      <Notice>
        Configuration only: saving or previewing does not send an API request.
        Use Run saved test to explicitly send a worker request.
      </Notice>
      {readOnly && (
        <Notice>Viewer access: this definition is read-only.</Notice>
      )}
      {error && <Notice error>{error}</Notice>}
      {initial && (
        <RunControls
          id={initial.id}
          kind="tests"
          organizationId={organizationId}
          environments={environments}
          readOnly={readOnly}
        />
      )}
      <fieldset disabled={busy}>
        <div className="builder-grid">
          <Field label="Test name">
            <input
              value={draft.name}
              maxLength={160}
              readOnly={readOnly}
              onChange={(e) => change({ name: e.target.value })}
            />
          </Field>
          <Field label="Tags (comma-separated)">
            <input
              value={draft.tags.join(",")}
              readOnly={readOnly}
              onChange={(e) =>
                change({
                  tags: e.target.value
                    ? e.target.value.split(",").map((v) => v.trim())
                    : [],
                })
              }
            />
          </Field>
        </div>
        <label>
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={readOnly}
            onChange={(e) => change({ enabled: e.target.checked })}
          />
          Test enabled (does not create a schedule)
        </label>
        <Tabs tabs={tabs} selected={tab} onSelect={setTab}>
          {tab === "Request" && (
            <>
              <div className="builder-grid">
                <Field label="HTTP method">
                  <select
                    value={
                      (STANDARD_METHODS as readonly string[]).includes(
                        draft.method,
                      )
                        ? draft.method
                        : "CUSTOM"
                    }
                    disabled={readOnly}
                    onChange={(e) =>
                      change({
                        method:
                          e.target.value === "CUSTOM"
                            ? "PURGE"
                            : e.target.value,
                        advancedMethod: e.target.value === "CUSTOM",
                        ...(["GET", "HEAD"].includes(e.target.value)
                          ? {
                              bodyMode: "NONE" as const,
                              bodyTemplate: null,
                              formRows: [],
                            }
                          : {}),
                      })
                    }
                  >
                    {STANDARD_METHODS.map((method) => (
                      <option key={method}>{method}</option>
                    ))}
                    <option value="CUSTOM">Custom (advanced)</option>
                  </select>
                </Field>
                {draft.advancedMethod && (
                  <Field label="Custom method">
                    <input
                      value={draft.method}
                      maxLength={16}
                      readOnly={readOnly}
                      onChange={(e) =>
                        change({ method: e.target.value.toUpperCase() })
                      }
                    />
                  </Field>
                )}
                <Field
                  label="URL template"
                  hint="Example: {{BASE_URL}}/health. No request is sent from this page."
                >
                  <input
                    value={draft.urlTemplate}
                    maxLength={2048}
                    readOnly={readOnly}
                    onChange={(e) => change({ urlTemplate: e.target.value })}
                  />
                </Field>
              </div>
              <RowsEditor
                label="Query"
                rows={draft.queryRows}
                readOnly={readOnly}
                onChange={(queryRows) => change({ queryRows })}
              />
              <RowsEditor
                label="Header"
                rows={draft.headerRows}
                readOnly={readOnly}
                onChange={(headerRows) => change({ headerRows })}
              />
              <h4>Authentication</h4>
              <p>
                Use secret references only for credentials. Create secrets in
                workspace settings; do not paste credentials here.
              </p>
              <Field label="Authentication type">
                <select
                  disabled={readOnly}
                  value={auth.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    change({
                      authConfig:
                        type === "BEARER"
                          ? { type, token: "{{API_TOKEN}}" }
                          : type === "BASIC"
                            ? { type, username: "", password: "{{PASSWORD}}" }
                            : type === "API_KEY"
                              ? {
                                  type,
                                  in: "HEADER",
                                  name: "X-API-Key",
                                  value: "{{API_KEY}}",
                                }
                              : type === "CUSTOM_HEADER"
                                ? {
                                    type,
                                    name: "X-Token",
                                    value: "{{API_TOKEN}}",
                                  }
                                : { type: "NONE" },
                    });
                  }}
                >
                  {["NONE", "BEARER", "BASIC", "API_KEY", "CUSTOM_HEADER"].map(
                    (type) => (
                      <option key={type}>{type}</option>
                    ),
                  )}
                </select>
              </Field>
              {auth.type === "BEARER" && (
                <Field label="Bearer secret reference">
                  <input
                    value={auth.token}
                    readOnly={readOnly}
                    onChange={(e) =>
                      change({ authConfig: { ...auth, token: e.target.value } })
                    }
                  />
                </Field>
              )}
              {auth.type === "BASIC" && (
                <>
                  <Field label="Basic username">
                    <input
                      value={auth.username}
                      readOnly={readOnly}
                      onChange={(e) =>
                        change({
                          authConfig: { ...auth, username: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="Password secret reference">
                    <input
                      value={auth.password}
                      readOnly={readOnly}
                      onChange={(e) =>
                        change({
                          authConfig: { ...auth, password: e.target.value },
                        })
                      }
                    />
                  </Field>
                </>
              )}
              {(auth.type === "API_KEY" || auth.type === "CUSTOM_HEADER") && (
                <>
                  {auth.type === "API_KEY" && (
                    <Field label="API key location">
                      <select
                        value={auth.in}
                        disabled={readOnly}
                        onChange={(e) =>
                          change({
                            authConfig: {
                              ...auth,
                              in: e.target.value as "HEADER" | "QUERY",
                            },
                          })
                        }
                      >
                        <option>HEADER</option>
                        <option>QUERY</option>
                      </select>
                    </Field>
                  )}
                  <Field label="Authentication key name">
                    <input
                      value={auth.name}
                      readOnly={readOnly}
                      onChange={(e) =>
                        change({
                          authConfig: { ...auth, name: e.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="Authentication secret reference">
                    <input
                      value={auth.value}
                      readOnly={readOnly}
                      onChange={(e) =>
                        change({
                          authConfig: { ...auth, value: e.target.value },
                        })
                      }
                    />
                  </Field>
                </>
              )}
              <Field
                label="Timeout (milliseconds)"
                hint="100–30,000 ms, also subject to the workspace limit."
              >
                <input
                  type="number"
                  min={100}
                  max={30000}
                  value={draft.timeoutMs}
                  readOnly={readOnly}
                  onChange={(e) =>
                    change({ timeoutMs: Number(e.target.value) })
                  }
                />
              </Field>
              <label>
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={draft.followRedirects}
                  onChange={(e) =>
                    change({
                      followRedirects: e.target.checked,
                      maxRedirects: e.target.checked ? 1 : 0,
                    })
                  }
                />
                Follow redirects
              </label>
              {draft.followRedirects && (
                <Field label="Maximum redirects">
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={draft.maxRedirects}
                    readOnly={readOnly}
                    onChange={(e) =>
                      change({ maxRedirects: Number(e.target.value) })
                    }
                  />
                </Field>
              )}
            </>
          )}
          {tab === "Body" && (
            <>
              <Field label="Body mode">
                <select
                  value={draft.bodyMode}
                  disabled={readOnly}
                  onChange={(e) =>
                    change({
                      bodyMode: e.target.value as TestDefinition["bodyMode"],
                      bodyTemplate:
                        e.target.value === "JSON"
                          ? "{}"
                          : ["NONE", "FORM_URLENCODED"].includes(e.target.value)
                            ? null
                            : "",
                      formRows: [],
                    })
                  }
                >
                  {["NONE", "JSON", "RAW", "XML", "FORM_URLENCODED"].map(
                    (mode) => (
                      <option key={mode}>{mode}</option>
                    ),
                  )}
                </select>
              </Field>
              <p>
                Body limit: 256 KiB. JSON variables must be inside quoted
                strings. GraphQL can use a JSON query/variables body; SOAP can
                use XML. GET/HEAD use no body.
              </p>
              {["JSON", "RAW", "XML"].includes(draft.bodyMode) && (
                <Field label="Body template">
                  <textarea
                    rows={12}
                    value={draft.bodyTemplate ?? ""}
                    maxLength={262144}
                    readOnly={readOnly}
                    onChange={(e) => change({ bodyTemplate: e.target.value })}
                  />
                </Field>
              )}
              {draft.bodyMode === "FORM_URLENCODED" && (
                <RowsEditor
                  label="Form"
                  rows={draft.formRows}
                  readOnly={readOnly}
                  onChange={(formRows) => change({ formRows })}
                />
              )}
            </>
          )}
          {tab === "Assertions" && (
            <AssertionsEditor
              assertions={draft.assertions}
              readOnly={readOnly}
              onChange={(assertions) => change({ assertions })}
            />
          )}
          {tab === "Environment" && (
            <>
              <Field label="Test environment">
                <select
                  value={draft.environmentId ?? ""}
                  disabled={readOnly}
                  onChange={(e) =>
                    change({ environmentId: e.target.value || null })
                  }
                >
                  <option value="">
                    No environment (literal, disabled drafts only)
                  </option>
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                onClick={() =>
                  doWork(async () => {
                    const valid = apiTestCreateSchema.parse(draft);
                    setPreview(
                      previewViewSchema.parse(
                        await api(
                          "/tests/preview",
                          "POST",
                          valid,
                          organizationId,
                        ),
                      ),
                    );
                  })
                }
              >
                Preview variables safely
              </Button>
              {preview && (
                <div>
                  <Notice>{preview.notice}</Notice>
                  <h4>Masked request preview</h4>
                  <pre>
                    {JSON.stringify(
                      {
                        url: preview.url,
                        query: preview.queryRows,
                        headers: preview.headerRows,
                        body: preview.body,
                        form: preview.formRows,
                        auth: preview.auth,
                      },
                      null,
                      2,
                    )}
                  </pre>
                  <h4>Public variables</h4>
                  <pre>{JSON.stringify(preview.variables, null, 2)}</pre>
                  <h4>Available secrets (masked)</h4>
                  <ul>
                    {preview.secretNames.map((name) => (
                      <li key={name}>{name}: ••••••••</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {tab === "Schedule" &&
            (initial ? (
              <SchedulePanel
                testId={initial.id}
                organizationId={organizationId}
                environments={environments}
                readOnly={readOnly}
              />
            ) : (
              <Notice>
                Scheduling is not available until you save the test.
              </Notice>
            ))}
          {tab === "History" &&
            (initial ? (
              <History
                kind="tests"
                id={initial.id}
                organizationId={organizationId}
              />
            ) : (
              <Notice>
                Execution history is not available until you save the definition
                first.
              </Notice>
            ))}
        </Tabs>
        <div className="builder-actions">
          {!readOnly && (
            <Button onClick={save}>{busy ? "Saving…" : "Save test"}</Button>
          )}
          <Button onClick={onCancel}>Close editor</Button>
        </div>
      </fieldset>
    </section>
  );
}

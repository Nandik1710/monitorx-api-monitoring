import { useEffect, useState, type ReactElement } from "react";
import { z } from "zod";
import { executionEventSchema, runViewSchema } from "@monitorx/contracts";
import { Button, Field, Notice } from "@monitorx/ui";
import { workspaceRequest as api } from "../workspace-api.js";
import { AppLink } from "../navigation.js";
export function RunControls({
  id,
  kind,
  organizationId,
  environments,
  readOnly,
}: {
  id: string;
  kind: "tests" | "collections";
  organizationId: string;
  environments: { id: string; name: string }[];
  readOnly: boolean;
}): ReactElement {
  const [environmentId, setEnvironment] = useState("");
  const [parallelism, setParallelism] = useState(2);
  const [runId, setRunId] = useState("");
  const [runs, setRuns] = useState<z.infer<typeof runViewSchema>[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [live, setLive] = useState(false);
  const pending =
    runs.length === 0 ||
    runs.some((r) => ["QUEUED", "RUNNING"].includes(r.status));
  const path = kind === "tests" ? "runs" : "collection-runs";
  useEffect(() => {
    if (!runId) return;
    let active = true;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await api(
          `/${path}/${runId}`,
          "GET",
          undefined,
          organizationId,
        );
        const rows =
          kind === "tests"
            ? [runViewSchema.parse(result)]
            : z.object({ executions: z.array(runViewSchema) }).parse(result)
                .executions;
        if (active) setRuns(rows);
      } catch {
        if (active)
          setMessage("Unable to refresh run. Sign in or retry later.");
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const interval = setInterval(() => {
      if (pending) void refresh();
    }, 2000);
    const url = new URL(
      "/api/v1/events",
      String(import.meta.env["VITE_API_BASE_URL"] ?? "http://localhost:4000"),
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("organizationId", organizationId);
    const socket = new WebSocket(url);
    socket.onopen = () => {
      if (active) setLive(true);
    };
    socket.onclose = () => {
      if (active) setLive(false);
    };
    socket.onmessage = (event) => {
      try {
        if (
          executionEventSchema.safeParse(JSON.parse(String(event.data))).success
        )
          void refresh();
      } catch {
        /* Ignore malformed notifications; polling remains authoritative. */
      }
    };
    return () => {
      active = false;
      clearInterval(interval);
      socket.close();
    };
  }, [runId, organizationId, kind, path, pending]);
  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = z.object({ runId: z.string().uuid() }).parse(
        await api(
          `/${kind}/${id}/run`,
          "POST",
          {
            environmentId,
            ...(kind === "collections" ? { parallelism } : {}),
          },
          organizationId,
        ),
      );
      setRuns([]);
      setRunId(result.runId);
      setMessage("Queued. A worker will execute the saved configuration.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to submit run.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Run controls">
      <h4>Run saved {kind === "tests" ? "test" : "collection"}</h4>
      <p>
        A manual run sends a real request from the worker. Unsaved edits are not
        included.
      </p>
      {!readOnly && (
        <>
          <Field label="Run environment">
            <select
              value={environmentId}
              onChange={(e) => setEnvironment(e.target.value)}
            >
              <option value="">Choose environment</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          {kind === "collections" && (
            <Field label="Collection parallelism">
              <select
                value={parallelism}
                onChange={(e) => setParallelism(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
          )}
          <Button
            disabled={!environmentId || busy}
            onClick={() => void submit()}
          >
            Run now
          </Button>
        </>
      )}
      {message && <Notice>{message}</Notice>}
      {runId && (
        <div aria-live="polite">
          <p>
            Run ID: {runId} ·{" "}
            {live ? "Live updates connected" : "Polling status"}
          </p>
          {runs.map((run) => (
            <p key={run.id}>
              <AppLink
                href={`/app/executions/${run.id}?organizationId=${organizationId}`}
              >
                {run.id}
              </AppLink>
              : {run.status} · {run.healthState} · {run.latencyMs ?? "—"} ms ·
              HTTP {run.httpStatus ?? "—"}
              {run.errorClass ? ` · ${run.errorClass}` : ""}
            </p>
          ))}
          {!readOnly && pending && (
            <Button
              onClick={() => {
                void api(`/${path}/${runId}/cancel`, "POST", {}, organizationId)
                  .then(() =>
                    setMessage(
                      "Cancellation requested. A sent request cannot be undone.",
                    ),
                  )
                  .catch(() =>
                    setMessage("Cancellation failed; refresh and retry."),
                  );
              }}
            >
              Cancel run
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

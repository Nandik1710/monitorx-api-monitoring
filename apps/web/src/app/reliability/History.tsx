import { useState, type ReactElement } from "react";
import {
  historyPageSchema,
  executionDetailSchema,
  type ReliabilityScope,
} from "@monitorx/contracts";
import { Button, Field, Notice, StatusLabel, CodeViewer } from "@monitorx/ui";
import { useResource, reliabilityLink } from "./use-resource.js";
import { AppLink } from "../navigation.js";
export function ExecutionDetail({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}): ReactElement {
  const { data, error, reload } = useResource(
    `/executions/${id}`,
    organizationId,
    executionDetailSchema,
  );
  return (
    <section aria-label="Execution details">
      <h2>Execution details</h2>
      <Button onClick={reload}>Refresh execution</Button>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <p role="status">Loading execution…</p>}
      {data && (
        <>
          <h3>{data.testName}</h3>
          <p>Run {data.id}</p>
          <p>
            <StatusLabel value={data.status} /> ·{" "}
            <StatusLabel value={data.healthState} />
          </p>
          <dl>
            <dt>Run kind</dt>
            <dd>{data.runKind}</dd>
            <dt>Created</dt>
            <dd>{new Date(data.createdAt).toLocaleString()}</dd>
            <dt>Started</dt>
            <dd>
              {data.startedAt
                ? new Date(data.startedAt).toLocaleString()
                : "Not started"}
            </dd>
            <dt>Completed</dt>
            <dd>
              {data.completedAt
                ? new Date(data.completedAt).toLocaleString()
                : "Not completed"}
            </dd>
            <dt>Latency</dt>
            <dd>{data.latencyMs ?? "—"} ms</dd>
            <dt>HTTP status</dt>
            <dd>{data.httpStatus ?? "No response"}</dd>
            <dt>Error class</dt>
            <dd>{data.errorClass ?? "None"}</dd>
            <dt>Response size</dt>
            <dd>{data.responseBytes ?? "—"} bytes</dd>
          </dl>
          {data.errorMessage && <Notice>{data.errorMessage}</Notice>}
          <CodeViewer
            label="Redacted request metadata"
            value={data.requestMetadata}
          />
          {data.previewExpired ? (
            <p>Response preview expired after 7 days.</p>
          ) : (
            <CodeViewer
              label="Redacted response preview"
              value={data.responsePreview ?? "No response preview available."}
            />
          )}
          <h3>Individual assertions</h3>
          {data.assertions.length === 0 ? (
            <p>No assertion results.</p>
          ) : (
            data.assertions.map((a) => (
              <details key={a.position}>
                <summary>
                  <StatusLabel value={a.passed ? "PASSED" : "FAILED"} /> ·{" "}
                  {a.type} · {a.severity}
                </summary>
                <p>{a.message}</p>
                <CodeViewer
                  label={`Assertion ${a.position + 1} expected`}
                  value={a.expected}
                />
                <CodeViewer
                  label={`Assertion ${a.position + 1} actual`}
                  value={a.actual}
                />
              </details>
            ))
          )}
        </>
      )}
    </section>
  );
}
export function History({
  kind,
  id,
  organizationId,
}: {
  kind: ReliabilityScope;
  id: string;
  organizationId: string;
}): ReactElement {
  const [page, setPage] = useState(1),
    [filters, setFilters] = useState("");
  const { data, error, reload } = useResource(
    `/${kind}/${id}/executions?page=${page}&limit=20${filters}`,
    organizationId,
    historyPageSchema,
  );
  return (
    <section aria-label="Execution history">
      <h2>Execution history</h2>
      <p>
        Newest first; retained for up to 90 days. Tags reflect the current test
        definition.
      </p>
      <form
        className="history-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget),
            query = new URLSearchParams();
          for (const [key, value] of fields) {
            if (typeof value === "string" && value)
              query.set(
                key,
                key === "from" || key === "to"
                  ? new Date(value).toISOString()
                  : value,
              );
          }
          setPage(1);
          setFilters(query.size ? `&${query}` : "");
        }}
      >
        <Field label="History status">
          <select name="status">
            <option value="">All statuses</option>
            {[
              "QUEUED",
              "RUNNING",
              "PASSED",
              "DEGRADED",
              "FAILED",
              "CANCELLED",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Run kind">
          <select name="runKind">
            <option value="">All run kinds</option>
            {["MANUAL", "COLLECTION", "SCHEDULED"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="From (local time)">
          <input name="from" type="datetime-local" />
        </Field>
        <Field label="To (local time)">
          <input name="to" type="datetime-local" />
        </Field>
        <Field label="Environment ID">
          <input
            name="environmentId"
            placeholder="Optional environment UUID"
            pattern="[0-9a-fA-F-]{36}"
          />
        </Field>
        <Field label="Test tag">
          <input name="tag" maxLength={40} />
        </Field>
        <Button type="submit">Apply history filters</Button>
      </form>
      <Button onClick={reload}>Refresh history</Button>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <p role="status">Loading history…</p>}
      {data && (
        <>
          {data.items.length === 0 ? (
            <p>No executions match these filters.</p>
          ) : (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Execution history table"
            >
              <table>
                <caption>Execution results</caption>
                <thead>
                  <tr>
                    {[
                      "Test / time",
                      "Status",
                      "Health",
                      "Kind",
                      "Latency",
                      "HTTP",
                      "Details",
                    ].map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.testName}
                        <br />
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <StatusLabel value={row.status} />
                      </td>
                      <td>
                        <StatusLabel value={row.healthState} />
                      </td>
                      <td>{row.runKind}</td>
                      <td>{row.latencyMs ?? "—"} ms</td>
                      <td>{row.httpStatus ?? "—"}</td>
                      <td>
                        <AppLink
                          href={reliabilityLink(
                            "executions",
                            row.id,
                            organizationId,
                          )}
                        >
                          View execution
                        </AppLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="builder-actions">
            <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous executions
            </Button>
            <span>
              Page {page} · {data.total} results
            </span>
            <Button
              disabled={page * 20 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next executions
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

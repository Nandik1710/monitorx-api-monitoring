import { useState, type ReactElement } from "react";
import {
  dashboardSchema,
  type ReliabilityScope,
  type Dashboard as DashboardData,
} from "@monitorx/contracts";
import { Button, Field, Notice, StatusLabel } from "@monitorx/ui";
import { useResource, reliabilityLink } from "./use-resource.js";
import { AppLink } from "../navigation.js";
const number = (n: number | null, unit: string) =>
  n === null ? "No data" : `${n.toFixed(1)}${unit}`;
export function Dashboard({
  kind,
  id,
  organizationId,
}: {
  kind: ReliabilityScope;
  id: string;
  organizationId: string;
}): ReactElement {
  const [range, setRange] = useState("24h");
  const { data, error, reload } = useResource(
    `/${kind}/${id}/dashboard?range=${range}`,
    organizationId,
    dashboardSchema,
  );
  function endpoints(title: string, rows: DashboardData["slowest"]) {
    return (
      <section>
        <h3>{title}</h3>
        {rows.length === 0 ? (
          <p>No endpoints to show.</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                <AppLink
                  href={reliabilityLink("tests", row.id, organizationId)}
                >
                  {row.name}
                </AppLink>{" "}
                · <StatusLabel value={row.health} /> · average{" "}
                {number(row.averageMs, " ms")}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  return (
    <section
      className="reliability-dashboard"
      aria-label={`${kind} reliability dashboard`}
    >
      <h2>{data?.name ?? "Reliability"} dashboard</h2>
      <Field label="Metrics range">
        <select value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </Field>
      <Button onClick={reload}>Refresh dashboard</Button>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <p role="status">Loading dashboard…</p>}
      {data && (
        <>
          <p>
            Updated {new Date(data.generatedAt).toLocaleString()}. Refresh for
            newer results.
          </p>
          <h3>Current health</h3>
          <ul className="health-counts">
            {data.health.map((h) => (
              <li key={h.state}>
                <StatusLabel value={h.state} />: {h.count}
              </li>
            ))}
          </ul>
          <dl className="metric-grid">
            {[
              ["Scheduled uptime", number(data.summary.uptime, "%")],
              ["Pass rate", number(data.summary.passRate, "%")],
              ["Average latency", number(data.summary.averageMs, " ms")],
              ["p50 latency", number(data.summary.p50, " ms")],
              ["p95 latency", number(data.summary.p95, " ms")],
              ["p99 latency", number(data.summary.p99, " ms")],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p>
            {data.summary.samples} completed samples;{" "}
            {data.summary.scheduledSamples} eligible scheduled samples. Uptime
            counts healthy or degraded scheduled outcomes, excluding
            paused/unknown. Pass rate covers all completed, non-cancelled runs.
            Latency includes failures with a measured duration.
          </p>
          {endpoints("Degraded or down endpoints (up to 10)", data.degraded)}
          {endpoints("Slowest endpoints (up to 10)", data.slowest)}
          <h3>Error classes</h3>
          {data.errors.length ? (
            <ul>
              {data.errors.map((e) => (
                <li key={e.errorClass}>
                  {e.errorClass}: {e.count}
                </li>
              ))}
            </ul>
          ) : (
            <p>No errors in this range.</p>
          )}
          <h3>Incidents · {data.openIncidents} open</h3>
          <p>
            Read-only incident records. Automatic incident creation and alert
            delivery belong to the next phase.
          </p>
          {data.incidents.length ? (
            <ul>
              {data.incidents.map((i) => (
                <li key={i.id}>
                  {i.testName} · {i.state} ·{" "}
                  {new Date(i.openedAt).toLocaleString()}
                </li>
              ))}
            </ul>
          ) : (
            <p>No recent or open incidents.</p>
          )}
        </>
      )}
    </section>
  );
}

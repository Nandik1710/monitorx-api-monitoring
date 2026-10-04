import type { ReactElement } from "react";
import { resourceIdSchema } from "@monitorx/contracts";
import { Dashboard } from "./Dashboard.js";
import { History, ExecutionDetail } from "./History.js";
export function ReliabilityPage(): ReactElement | null {
  const match =
    /^\/app\/(projects|collections|tests|executions)\/([^/]+)$/.exec(
      window.location.pathname,
    );
  if (!match) return null;
  const id = resourceIdSchema.safeParse(match[2]),
    org = resourceIdSchema.safeParse(
      new URLSearchParams(window.location.search).get("organizationId"),
    );
  if (!id.success || !org.success)
    return (
      <p role="alert">
        Invalid view address. <a href="/">Return to workspace</a>
      </p>
    );
  const kind = match[1];
  return (
    <>
      <p>
        <a href="/">← Return to workspace</a>
      </p>
      {kind === "executions" ? (
        <ExecutionDetail id={id.data} organizationId={org.data} />
      ) : kind === "projects" || kind === "collections" || kind === "tests" ? (
        <>
          <Dashboard kind={kind} id={id.data} organizationId={org.data} />
          <History kind={kind} id={id.data} organizationId={org.data} />
        </>
      ) : null}
    </>
  );
}

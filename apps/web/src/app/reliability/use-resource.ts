import { useEffect, useState } from "react";
import type { z } from "zod";
import { workspaceRequest } from "../workspace-api.js";
export function useResource<T, Input>(
  path: string | null,
  organizationId: string,
  schema: z.ZodType<T, z.ZodTypeDef, Input>,
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    if (!path)
      return () => {
        active = false;
      };
    void workspaceRequest(path, "GET", undefined, organizationId)
      .then((raw) => {
        if (active) setData(schema.parse(raw));
      })
      .catch(() => {
        if (active)
          setError(
            "Unable to load this view. Check your access and try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [path, organizationId, schema, refresh]);
  return { data, error, reload: () => setRefresh((n) => n + 1) };
}
export function reliabilityLink(
  kind: string,
  id: string,
  organizationId: string,
) {
  return `/app/${kind}/${encodeURIComponent(id)}?organizationId=${encodeURIComponent(organizationId)}`;
}

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { z } from "zod";
import {
  organizationViewSchema,
  projectViewSchema,
  resourceIdSchema,
} from "@monitorx/contracts";
import { workspaceRequest as api } from "./workspace-api.js";
export type Organization = z.infer<typeof organizationViewSchema>;
export type Project = z.infer<typeof projectViewSchema>;
interface Scope {
  organizations: Organization[];
  projects: Project[];
  organization: Organization | undefined;
  project: Project | undefined;
  organizationId: string;
  projectId: string;
  loading: boolean;
  error: string;
  refresh: () => void;
  manage: boolean;
}
const Context = createContext<Scope | null>(null);
export function ScopeProvider({ children }: { children: ReactNode }) {
  const [query] = useSearchParams(),
    location = useLocation();
  const candidate = query.get("organizationId"),
    organizationId = resourceIdSchema.safeParse(candidate).success
      ? candidate!
      : "";
  const projectCandidate =
    /^\/app\/projects\/([^/]+)/.exec(location.pathname)?.[1] ??
    query.get("projectId");
  const projectId = resourceIdSchema.safeParse(projectCandidate).success
    ? projectCandidate!
    : "";
  const [state, setState] = useState<{
    organizations: Organization[];
    projects: Project[];
    key: string;
    loading: boolean;
    error: string;
  }>({ organizations: [], projects: [], key: "", loading: true, error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    void Promise.all([
      api("/organizations?limit=100"),
      organizationId
        ? api("/projects?limit=100", "GET", undefined, organizationId)
        : Promise.resolve({ items: [] }),
    ])
      .then(([orgs, projects]) => {
        if (active)
          setState({
            organizations: z
              .object({ items: z.array(organizationViewSchema) })
              .parse(orgs).items,
            projects: z
              .object({ items: z.array(projectViewSchema) })
              .parse(projects).items,
            key: organizationId,
            loading: false,
            error: "",
          });
      })
      .catch(() => {
        if (active)
          setState({
            organizations: [],
            projects: [],
            key: organizationId,
            loading: false,
            error: "Unable to load this workspace. Check your access or retry.",
          });
      });
    return () => {
      active = false;
    };
  }, [organizationId, revision]);
  const valid = state.key === organizationId,
    organization = valid
      ? state.organizations.find((o) => o.id === organizationId)
      : undefined,
    projects = valid ? state.projects : [];
  return (
    <Context.Provider
      value={{
        organizations: state.organizations,
        projects,
        organization,
        project: projects.find((p) => p.id === projectId),
        organizationId,
        projectId,
        loading: state.loading || !valid,
        error: state.error,
        refresh: () => setRevision((n) => n + 1),
        manage:
          organization?.role === "OWNER" || organization?.role === "ADMIN",
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useScope() {
  const scope = useContext(Context);
  if (!scope) throw Error("Workspace scope missing");
  return scope;
}

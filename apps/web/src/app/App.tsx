import { useEffect, useState } from "react";
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  Navigate,
  useLocation,
  useParams,
  useNavigate,
  type RouteObject,
} from "react-router-dom";
import { Button, ConfirmProvider } from "@monitorx/ui";
import { resourceIdSchema } from "@monitorx/contracts";
import { SessionProvider, useSession } from "./session.js";
import { ScopeProvider, useScope } from "./scope.js";
import { AppShell } from "./AppShell.js";
import { AuthPanel } from "./AuthPanel.js";
import { AppLink, scopedLink } from "./navigation.js";
import {
  WorkspacesPage,
  ProjectsPage,
  ProjectSettingsPage,
} from "./pages/WorkspacePages.js";
import {
  CollectionsPage,
  CollectionPage,
  TestEditorPage,
} from "./pages/TestPages.js";
import { EnvironmentsPage } from "./pages/EnvironmentPage.js";
import { TeamPage } from "./pages/TeamPage.js";
import { EmptyState, Loading, PageHeader } from "./pages/shared.js";
import { Dashboard } from "./reliability/Dashboard.js";
import { History, ExecutionDetail } from "./reliability/History.js";
function Root() {
  return (
    <SessionProvider>
      <ConfirmProvider>
        <LinkRedirect />
        <Outlet />
      </ConfirmProvider>
    </SessionProvider>
  );
}
function LinkRedirect() {
  const { link } = useSession(),
    location = useLocation();
  return link &&
    link.kind !== "invitation" &&
    !location.pathname.startsWith(`/auth/${link.kind}`) ? (
    <Navigate to={`/auth/${link.kind}`} replace />
  ) : null;
}
function RequireSession() {
  const session = useSession(),
    location = useLocation();
  if (session.loading) return <Loading />;
  return session.user ? (
    <ScopeProvider>
      <AppShell />
    </ScopeProvider>
  ) : (
    <Navigate
      to="/auth/login"
      state={{ from: location.pathname + location.search }}
      replace
    />
  );
}
function ScopeGate({ project = false }: { project?: boolean }) {
  const scope = useScope(),
    params = useParams();
  if (
    !scope.organization ||
    (params["id"] && !resourceIdSchema.safeParse(params["id"]).success)
  )
    return (
      <EmptyState title="Workspace or page unavailable" href="/app/workspaces">
        Choose a workspace you can access, then open the page again.
      </EmptyState>
    );
  if (project && !scope.project)
    return (
      <EmptyState
        title="Choose a project"
        href={scopedLink("/app/projects", scope.organizationId)}
      >
        Select a project from this workspace.
      </EmptyState>
    );
  return <Outlet />;
}
function ProjectOverview() {
  const scope = useScope();
  return (
    <>
      <div className="page-tabs">
        <AppLink
          href={scopedLink(
            `/app/projects/${scope.projectId}`,
            scope.organizationId,
          )}
          aria-current="page"
        >
          Overview
        </AppLink>
        <AppLink
          href={scopedLink(
            `/app/projects/${scope.projectId}/tests`,
            scope.organizationId,
          )}
        >
          Collections & tests
        </AppLink>
        <AppLink
          href={scopedLink(
            `/app/projects/${scope.projectId}/history`,
            scope.organizationId,
          )}
        >
          History
        </AppLink>
        <AppLink
          href={scopedLink(
            `/app/projects/${scope.projectId}/settings`,
            scope.organizationId,
          )}
        >
          Project settings
        </AppLink>
      </div>
      <Dashboard
        kind="projects"
        id={scope.projectId}
        organizationId={scope.organizationId}
      />
    </>
  );
}
function ReliabilityRoute({
  kind,
  history = false,
}: {
  kind: "projects" | "collections" | "tests" | "executions";
  history?: boolean;
}) {
  const navigate = useNavigate();
  const { id = "" } = useParams(),
    scope = useScope();
  const content =
    kind === "executions" ? (
      <ExecutionDetail id={id} organizationId={scope.organizationId} />
    ) : history ? (
      <History kind={kind} id={id} organizationId={scope.organizationId} />
    ) : (
      <>
        <Dashboard kind={kind} id={id} organizationId={scope.organizationId} />
        {kind === "tests" && (
          <>
            <AppLink
              className="ui-button"
              href={scopedLink(
                `/app/tests/${id}/edit`,
                scope.organizationId,
                scope.projectId || undefined,
              )}
            >
              Open test editor & schedule
            </AppLink>
            <History
              kind="tests"
              id={id}
              organizationId={scope.organizationId}
            />
          </>
        )}
      </>
    );
  return (
    <>
      <div className="builder-actions">
        <Button
          onClick={() => {
            if (window.history.state?.idx > 0) navigate(-1);
            else navigate(scopedLink("/app/projects", scope.organizationId));
          }}
        >
          ← Back
        </Button>
      </div>
      {content}
    </>
  );
}
function Guide() {
  return (
    <>
      <PageHeader
        title="From request to insight"
        eyebrow="QUICK START"
        description="A short path to your first reliable API check."
      />
      <div className="guide-grid">
        {[
          [
            "01",
            "Create your workspace",
            "Open Workspaces, create or choose a team workspace, then add a project.",
          ],
          [
            "02",
            "Set up an environment",
            "Add public variables and encrypted secrets. Credentials never belong in public fields.",
          ],
          [
            "03",
            "Define a check",
            "Create a collection and test. Set the request and add a required status assertion. Save first.",
          ],
          [
            "04",
            "Run and inspect",
            "Choose the run environment and click Run now. The worker sends the request; open the execution to inspect assertions.",
          ],
          [
            "05",
            "Make it recurring",
            "Enable the test, configure its Schedule tab, then enable the schedule. Pause it when you’re done.",
          ],
          [
            "06",
            "Follow reliability",
            "Use Overview and Execution history. Uptime needs scheduled samples; No data never means 100%.",
          ],
        ].map(([n, title, body]) => (
          <section className="panel" key={n}>
            <span className="guide-number">{n}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </section>
        ))}
      </div>
      <section className="panel">
        <h3>What to expect</h3>
        <p>
          Only public HTTP(S) targets you are authorized to monitor are allowed.
          Private addresses are blocked. Incidents are currently read-only;
          automated alerts belong to the next phase.
        </p>
        <p>
          This interface is optimized for laptop and desktop browsers at 1024px
          and wider. Use the theme control to switch between light and dark.
        </p>
      </section>
    </>
  );
}
function NotFound() {
  return (
    <EmptyState
      title="This page does not exist"
      href="/app/workspaces"
      action="Back to workspaces"
    >
      The link may be outdated. Your workspace data has not changed.
    </EmptyState>
  );
}
export const appRoutes: RouteObject[] = [
  {
    element: <Root />,
    errorElement: (
      <div className="route-error">
        <h1>Something interrupted this page</h1>
        <p>
          Reload the page to restore your session. No monitored request is
          started by reloading.
        </p>
        <a href="/app/workspaces">Return to workspaces</a>
      </div>
    ),
    children: [
      { path: "/", element: <Navigate to="/app/workspaces" replace /> },
      { path: "/auth/:mode", element: <AuthPanel /> },
      {
        path: "/app",
        element: <RequireSession />,
        children: [
          { index: true, element: <Navigate to="workspaces" replace /> },
          { path: "workspaces", element: <WorkspacesPage /> },
          { path: "guide", element: <Guide /> },
          {
            element: <ScopeGate />,
            children: [
              { path: "projects", element: <ProjectsPage /> },
              { path: "team", element: <TeamPage /> },
              { path: "collections/:id", element: <CollectionPage /> },
              {
                path: "collections/:id/overview",
                element: <ReliabilityRoute kind="collections" />,
              },
              {
                path: "collections/:id/history",
                element: <ReliabilityRoute kind="collections" history />,
              },
              {
                path: "collections/:id/new-test",
                element: <TestEditorPage create />,
              },
              { path: "tests/:id", element: <ReliabilityRoute kind="tests" /> },
              { path: "tests/:id/edit", element: <TestEditorPage /> },
              {
                path: "executions/:id",
                element: <ReliabilityRoute kind="executions" />,
              },
              {
                element: <ScopeGate project />,
                children: [
                  { path: "projects/:id", element: <ProjectOverview /> },
                  { path: "projects/:id/tests", element: <CollectionsPage /> },
                  {
                    path: "projects/:id/history",
                    element: <ReliabilityRoute kind="projects" history />,
                  },
                  {
                    path: "projects/:id/environments",
                    element: <EnvironmentsPage />,
                  },
                  {
                    path: "projects/:id/settings",
                    element: <ProjectSettingsPage />,
                  },
                ],
              },
            ],
          },
          { path: "*", element: <NotFound /> },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];
export function App() {
  const [router] = useState(() => createBrowserRouter(appRoutes));
  useEffect(() => {
    document.title = "Monitor-X · Reliability workspace";
  }, []);
  return <RouterProvider router={router} />;
}

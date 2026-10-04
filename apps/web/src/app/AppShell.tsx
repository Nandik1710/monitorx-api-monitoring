import { useEffect } from "react";
import { Outlet, useLocation, useNavigate, NavLink } from "react-router-dom";
import {
  RiPulseLine,
  RiDashboardLine,
  RiFolder3Line,
  RiFlaskLine,
  RiHistoryLine,
  RiSettings3Line,
  RiTeamLine,
  RiStackLine,
  RiArrowRightSLine,
  RiLogoutBoxRLine,
  RiBookOpenLine,
} from "@remixicon/react";
import { Button } from "@monitorx/ui";
import { useScope } from "./scope.js";
import { useSession } from "./session.js";
import { workspaceRequest as api } from "./workspace-api.js";
import { AppLink, scopedLink, ThemeToggle } from "./navigation.js";
import { Loading, useAction } from "./pages/shared.js";
export function AppShell() {
  const scope = useScope(),
    session = useSession(),
    navigate = useNavigate(),
    location = useLocation(),
    action = useAction();
  const { organizationId, projectId } = scope;
  const projectBase = projectId ? `/app/projects/${projectId}` : "";
  const link = (path: string) =>
    scopedLink(path, organizationId, projectId || undefined);
  useEffect(() => {
    document.getElementById("page-content")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  const items = [
    {
      label: "Workspaces",
      path: "/app/workspaces",
      icon: RiStackLine,
      ready: true,
    },
    {
      label: "Projects",
      path: "/app/projects",
      icon: RiFolder3Line,
      ready: !!organizationId,
    },
    {
      label: "Overview",
      path: projectBase,
      icon: RiDashboardLine,
      ready: !!projectId,
    },
    {
      label: "Collections & tests",
      path: `${projectBase}/tests`,
      icon: RiFlaskLine,
      ready: !!projectId,
    },
    {
      label: "Execution history",
      path: `${projectBase}/history`,
      icon: RiHistoryLine,
      ready: !!projectId,
    },
    {
      label: "Environments",
      path: `${projectBase}/environments`,
      icon: RiSettings3Line,
      ready: !!projectId,
    },
    {
      label: "Team & access",
      path: "/app/team",
      icon: RiTeamLine,
      ready: !!organizationId,
    },
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#page-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <AppLink href="/app/workspaces" className="brand">
          <span className="brand-mark">
            <RiPulseLine size={23} />
          </span>
          monitor<span className="brand-x">x</span>
          <span className="brand-divider">/</span>
        </AppLink>
        <div className="sidebar-scope">
          <label>
            WORKSPACE
            <select
              aria-label="Workspace"
              value={organizationId}
              onChange={(e) =>
                navigate(
                  e.target.value
                    ? scopedLink("/app/projects", e.target.value)
                    : "/app/workspaces",
                )
              }
            >
              <option value="">Select workspace</option>
              {scope.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          {organizationId && (
            <label>
              PROJECT
              <select
                aria-label="Project"
                value={projectId}
                onChange={(e) =>
                  navigate(
                    scopedLink(
                      e.target.value
                        ? `/app/projects/${e.target.value}`
                        : "/app/projects",
                      organizationId,
                    ),
                  )
                }
              >
                <option value="">Select project</option>
                {scope.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <span className="nav-label">EXPLORER</span>
        <nav aria-label="Main navigation">
          {items.map((item) =>
            item.ready ? (
              <NavLink
                key={item.label}
                to={
                  item.path === "/app/workspaces" ? item.path : link(item.path)
                }
                end
                className={({ isActive }) =>
                  `sidebar-link${
                    isActive ||
                    (item.label === "Collections & tests" &&
                      /^\/app\/(collections|tests)\//.test(
                        location.pathname,
                      )) ||
                    (item.label === "Execution history" &&
                      location.pathname.startsWith("/app/executions/"))
                      ? " active"
                      : ""
                  }`
                }
              >
                <item.icon size={18} />
                {item.label}
              </NavLink>
            ) : (
              <span
                className="sidebar-link disabled"
                key={item.label}
                title="Choose a workspace and project first"
              >
                <item.icon size={18} />
                {item.label}
              </span>
            ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <AppLink href="/app/guide" className="sidebar-link">
            <RiBookOpenLine size={18} />
            Quick start
          </AppLink>
          <div className="sidebar-note">
            <span className="tiny-indicator" />
            Local development<span>Phases 1—9</span>
          </div>
          <div className="user-card">
            <span className="avatar">
              {session.user?.displayName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong>{session.user?.displayName}</strong>
              <span>{scope.organization?.role ?? "Account"}</span>
            </div>
            <Button
              variant="ghost"
              aria-label="Sign out"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api("/auth/logout", "POST", {});
                  session.setUser(undefined);
                  navigate("/auth/login", { replace: true });
                })
              }
            >
              <RiLogoutBoxRLine size={18} />
            </Button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <nav aria-label="Breadcrumb">
            <AppLink href="/app/workspaces">Workspace</AppLink>
            <RiArrowRightSLine size={16} />
            <span>{scope.organization?.name ?? "Your workspaces"}</span>
            {scope.project && (
              <>
                <RiArrowRightSLine size={16} />
                <strong>{scope.project.name}</strong>
              </>
            )}
          </nav>
          <div className="topbar-tools">
            <span className="environment-badge">DEVELOPMENT</span>
            <ThemeToggle />
          </div>
        </header>
        <main
          id="page-content"
          tabIndex={-1}
          className="page-content"
          key={location.pathname + organizationId}
        >
          {action.notice}
          {scope.loading ? (
            <Loading />
          ) : scope.error ? (
            <Loading error={scope.error} reload={scope.refresh} />
          ) : (
            <Outlet />
          )}
        </main>
        <footer className="app-statusbar">
          <span>
            <RiShieldCheckIcon />
            Authenticated workspace
          </span>
          <span>PostgreSQL-backed · requests run in workers</span>
          <span>Monitor-X / 0.1</span>
        </footer>
      </div>
    </div>
  );
}
function RiShieldCheckIcon() {
  return <span aria-hidden="true">◇</span>;
}

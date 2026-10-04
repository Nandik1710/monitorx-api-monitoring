// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { appRoutes } from "../../apps/web/src/app/App.js";
import { readLinkToken } from "../../apps/web/src/app/session.js";
import { workspaceRequest } from "../../apps/web/src/app/workspace-api.js";
import { AppLink, ThemeToggle } from "../../apps/web/src/app/navigation.js";

vi.mock("../../apps/web/src/app/workspace-api.js", () => ({
  workspaceRequest: vi.fn(),
}));
const api = vi.mocked(workspaceRequest);
const orgId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const collectionId = "00000000-0000-4000-8000-000000000003";
const timestamps = {
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
};
const org = {
  id: orgId,
  name: "Test workspace",
  slug: "test-workspace",
  role: "OWNER",
  testTimeoutLimitMs: 30000,
  executionRateLimitPerMinute: null,
  ...timestamps,
};
const project = {
  id: projectId,
  organizationId: orgId,
  name: "Test project",
  slug: "test-project",
  archivedAt: null,
  ...timestamps,
};
const collection = {
  id: collectionId,
  organizationId: orgId,
  projectId,
  name: "Test collection",
  description: null,
  ...timestamps,
};
const user = {
  id: orgId,
  email: "ui@example.test",
  displayName: "UI tester",
  emailVerified: true,
};
let role = "OWNER";
const routers: ReturnType<typeof createMemoryRouter>[] = [];
function open(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  routers.push(router);
  render(<RouterProvider router={router} />);
  return router;
}
beforeEach(() => {
  role = "OWNER";
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  api.mockImplementation(async (path) => {
    if (path === "/auth/me") return { user };
    if (path === "/auth/config") return { githubEnabled: false };
    if (path === "/organizations?limit=100")
      return { items: [{ ...org, role }] };
    if (path === "/projects?limit=100") return { items: [project] };
    if (path === `/collections/${collectionId}`) return collection;
    if (path.includes("/environments")) return { items: [] };
    if (path.startsWith("/collections?"))
      return { items: [collection], total: 1 };
    if (path.startsWith("/tests?")) return { items: [], total: 0 };
    throw Error("Not available in this fixture.");
  });
});
afterEach(() => {
  cleanup();
  routers.splice(0).forEach((router) => router.dispose());
  vi.restoreAllMocks();
  vi.resetAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  window.history.replaceState(null, "", "/");
});

it("redirects a signed-out deep link to sign-in without requesting tenant data", async () => {
  api.mockRejectedValue(Error("Sign in required"));
  const router = open(
    `/app/projects/${projectId}/tests?organizationId=${orgId}`,
  );
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  expect(router.state.location.pathname).toBe("/auth/login");
  expect(api.mock.calls.every(([path]) => path.startsWith("/auth/"))).toBe(
    true,
  );
});

it("opens a bookmarked project library with tenant scope and separate collection links", async () => {
  open(`/app/projects/${projectId}/tests?organizationId=${orgId}`);
  expect(
    await screen.findByRole("heading", { name: "Test collection" }),
  ).toBeTruthy();
  expect(api).toHaveBeenCalledWith(
    `/collections?projectId=${projectId}&page=1&limit=20`,
    "GET",
    undefined,
    orgId,
  );
  fireEvent.click(screen.getByRole("link", { name: /Test collection/ }));
  expect(
    await screen.findByRole("heading", { name: "No tests in this collection" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "New API test" }).getAttribute("href"),
  ).toContain(`/collections/${collectionId}/new-test`);
});

it("rejects malformed tenant context without querying tenant endpoints", async () => {
  open(`/app/projects/${projectId}/tests?organizationId=invalid`);
  expect(await screen.findByText("Workspace or page unavailable")).toBeTruthy();
  expect(api.mock.calls.some(([path]) => path.startsWith("/collections"))).toBe(
    false,
  );
});

it("does not show stale tenant content after access is denied", async () => {
  api.mockImplementation(async (path) => {
    if (path === "/auth/me") return { user };
    if (path.startsWith("/organizations")) return { items: [org] };
    throw Error("Access denied");
  });
  open(`/app/projects/${projectId}/tests?organizationId=${orgId}`);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Test collection")).toBeNull();
});

it("hides library creation and team administration for Viewers", async () => {
  role = "VIEWER";
  const router = open(
    `/app/projects/${projectId}/tests?organizationId=${orgId}`,
  );
  expect(
    await screen.findByRole("heading", { name: "Test collection" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New collection" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Team & access" }));
  expect(await screen.findByText("Read-only access")).toBeTruthy();
  expect(router.state.location.pathname).toBe("/app/team");
  expect(api.mock.calls.some(([path]) => path.includes("/members"))).toBe(
    false,
  );
});

it("protects dirty editor navigation, supports cancel, and confirms discard", async () => {
  const router = open(
    `/app/collections/${collectionId}/new-test?organizationId=${orgId}&projectId=${projectId}`,
  );
  fireEvent.change(await screen.findByLabelText("Test name"), {
    target: { value: "Unsaved request" },
  });
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("link", { name: "← Collection" }));
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect((screen.getByLabelText("Test name") as HTMLInputElement).value).toBe(
    "Unsaved request",
  );
  fireEvent.click(screen.getByRole("link", { name: "← Collection" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      `/app/collections/${collectionId}`,
    ),
  );
  expect(
    api.mock.calls.every(([, method]) => !method || method === "GET"),
  ).toBe(true);
});

it("saves the editor and navigates without an unsaved-changes prompt", async () => {
  const previous = api.getMockImplementation()!;
  api.mockImplementation(async (...args) =>
    args[0] === "/tests" ? {} : previous(...args),
  );
  const router = open(
    `/app/collections/${collectionId}/new-test?organizationId=${orgId}&projectId=${projectId}`,
  );
  fireEvent.change(await screen.findByLabelText("Test name"), {
    target: { value: "Saved request" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save test" }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      `/app/collections/${collectionId}`,
    ),
  );
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(api).toHaveBeenCalledWith(
    "/tests",
    "POST",
    expect.objectContaining({ name: "Saved request", enabled: false }),
    orgId,
  );
});

it("persists theme selection without storing account data", () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("monitorx.theme.v1")).toBe("dark");
  expect(localStorage.length).toBe(1);
});

it("parses email links strictly and removes their fragment from the address bar", async () => {
  const fake = "a".repeat(43);
  expect(readLinkToken("#verify-email=invalid")).toBeUndefined();
  expect(readLinkToken(`#invitation=${orgId}.${fake}`)?.organizationId).toBe(
    orgId,
  );
  expect(readLinkToken(`#invitation=${orgId}.${fake}.extra`)).toBeUndefined();
  window.history.replaceState(null, "", `/#verify-email=${fake}`);
  open("/auth/verify-email");
  expect(
    await screen.findByRole("heading", { name: "Verify your email" }),
  ).toBeTruthy();
  expect(window.location.hash).toBe("");
  expect(localStorage.length).toBe(1); // Theme preference only.
});

it("keeps project context in same-workspace result links but never across tenants", () => {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            <AppLink
              href={`/app/executions/${collectionId}?organizationId=${orgId}`}
            >
              Same workspace
            </AppLink>
            <AppLink
              href={`/app/executions/${collectionId}?organizationId=${collectionId}`}
            >
              Other workspace
            </AppLink>
          </>
        ),
      },
    ],
    {
      initialEntries: [
        `/app/projects/${projectId}/history?organizationId=${orgId}`,
      ],
    },
  );
  routers.push(router);
  render(<RouterProvider router={router} />);
  expect(screen.getByText("Same workspace").getAttribute("href")).toContain(
    `projectId=${projectId}`,
  );
  expect(
    screen.getByText("Other workspace").getAttribute("href"),
  ).not.toContain("projectId=");
});

it("redirects an expired session out of the protected workspace", async () => {
  open("/app/workspaces");
  expect(
    await screen.findByRole("heading", { name: "Your workspaces" }),
  ).toBeTruthy();
  fireEvent(window, new Event("monitorx:session-expired"));
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Your workspaces" })).toBeNull();
});

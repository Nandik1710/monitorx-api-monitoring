// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dashboard } from "../../apps/web/src/app/reliability/Dashboard.js";
import {
  History,
  ExecutionDetail,
} from "../../apps/web/src/app/reliability/History.js";
import { workspaceRequest } from "../../apps/web/src/app/workspace-api.js";
import { historyQuerySchema } from "../../packages/contracts/src/reliability.js";
vi.mock("../../apps/web/src/app/workspace-api.js", () => ({
  workspaceRequest: vi.fn(),
}));
const api = vi.mocked(workspaceRequest),
  id = "00000000-0000-4000-8000-000000000001",
  props = { id, organizationId: id, kind: "projects" as const };
const dashboard = {
  name: "Demo",
  range: "24h",
  generatedAt: new Date().toISOString(),
  summary: {
    samples: 0,
    scheduledSamples: 0,
    uptime: null,
    passRate: null,
    averageMs: null,
    p50: null,
    p95: null,
    p99: null,
  },
  health: [{ state: "UNKNOWN", count: 1 }],
  errors: [],
  degraded: [],
  slowest: [],
  openIncidents: 0,
  incidents: [],
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("compares ISO timestamps numerically despite differing fractional precision", () => {
  expect(
    historyQuerySchema.safeParse({
      from: "2026-10-04T00:00:00.100Z",
      to: "2026-10-04T00:00:00Z",
    }).success,
  ).toBe(false);
  expect(
    historyQuerySchema.safeParse({
      from: "2026-10-04T00:00:00Z",
      to: "2026-10-04T00:00:00.100Z",
    }).success,
  ).toBe(true);
});
it("shows no data honestly, health text and selectable metric ranges", async () => {
  api.mockResolvedValue(dashboard);
  render(<Dashboard {...props} />);
  expect(await screen.findByText("Demo dashboard")).toBeTruthy();
  expect(screen.getAllByText("No data")).toHaveLength(6);
  expect(screen.getByText("UNKNOWN")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Metrics range"), {
    target: { value: "7d" },
  });
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      `/projects/${id}/dashboard?range=7d`,
      "GET",
      undefined,
      id,
    ),
  );
});
it("exposes errors and reload without stale dashboard data", async () => {
  api.mockRejectedValue(new Error("fixture"));
  render(<Dashboard {...props} />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  api.mockResolvedValue(dashboard);
  fireEvent.click(screen.getByRole("button", { name: "Refresh dashboard" }));
  expect(await screen.findByText("Demo dashboard")).toBeTruthy();
});
it("filters and paginates empty history safely", async () => {
  api.mockResolvedValue({ items: [], total: 25, page: 1, limit: 20 });
  render(<History {...props} />);
  expect(
    await screen.findByText("No executions match these filters."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next executions" }));
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      `/projects/${id}/executions?page=2&limit=20`,
      "GET",
      undefined,
      id,
    ),
  );
  fireEvent.change(screen.getByLabelText("History status"), {
    target: { value: "FAILED" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Apply history filters" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      `/projects/${id}/executions?page=1&limit=20&status=FAILED`,
      "GET",
      undefined,
      id,
    ),
  );
});
it("renders escaped details, assertions, copy controls and preview expiry", async () => {
  const detail = {
    id,
    testId: id,
    testName: "Example",
    environmentId: id,
    status: "FAILED",
    healthState: "DOWN",
    createdAt: new Date().toISOString(),
    completedAt: null,
    startedAt: null,
    runKind: "MANUAL",
    latencyMs: 12,
    httpStatus: 500,
    errorClass: "assertion_failure",
    cancelRequested: false,
    errorMessage: null,
    requestMetadata: { method: "GET" },
    responsePreview: "<script>not executed</script>",
    previewExpired: false,
    responseBytes: 1,
    assertions: [
      {
        position: 0,
        type: "status",
        severity: "REQUIRED",
        passed: false,
        expected: 200,
        actual: 500,
        message: "Assertion failed",
      },
    ],
  };
  api.mockResolvedValue(detail);
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  const { unmount } = render(<ExecutionDetail id={id} organizationId={id} />);
  expect(await screen.findByText(detail.responsePreview)).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Copy Redacted response preview" }),
  );
  await waitFor(() =>
    expect(copy).toHaveBeenCalledWith(detail.responsePreview),
  );
  expect(screen.getByText("Individual assertions")).toBeTruthy();
  unmount();
  api.mockResolvedValue({
    ...detail,
    previewExpired: true,
    responsePreview: null,
  });
  render(<ExecutionDetail id={id} organizationId={id} />);
  expect(
    await screen.findByText("Response preview expired after 7 days."),
  ).toBeTruthy();
});

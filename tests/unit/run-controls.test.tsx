// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RunControls } from "../../apps/web/src/app/builder/RunControls.js";
import { workspaceRequest } from "../../apps/web/src/app/workspace-api.js";
vi.mock("../../apps/web/src/app/workspace-api.js", () => ({
  workspaceRequest: vi.fn(),
}));
const api = vi.mocked(workspaceRequest);
const id = "00000000-0000-4000-8000-000000000001";
const props = {
  id,
  kind: "tests" as const,
  organizationId: id,
  environments: [{ id, name: "Development" }],
  readOnly: false,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("requires explicit environment and hides run actions from Viewer", () => {
  const { unmount } = render(<RunControls {...props} />);
  expect(
    (screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  unmount();
  render(<RunControls {...props} readOnly />);
  expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
});
it("submits asynchronously, renders status and cancels with a tenant-scoped request", async () => {
  class Socket {
    close() {}
  }
  vi.stubGlobal("WebSocket", Socket);
  api.mockImplementation(async (path) =>
    path.endsWith("/run")
      ? { runId: id }
      : path.endsWith("/cancel")
        ? { cancelled: true }
        : {
            id,
            testId: id,
            status: "QUEUED",
            healthState: "UNKNOWN",
            createdAt: new Date().toISOString(),
            completedAt: null,
            latencyMs: null,
            httpStatus: null,
            errorClass: null,
            cancelRequested: false,
          },
  );
  render(<RunControls {...props} />);
  fireEvent.change(screen.getByLabelText("Run environment"), {
    target: { value: id },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run now" }));
  await waitFor(() =>
    expect(screen.getByText(/QUEUED · UNKNOWN/)).toBeTruthy(),
  );
  expect(api).toHaveBeenCalledWith(
    `/tests/${id}/run`,
    "POST",
    { environmentId: id },
    id,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(`/runs/${id}/cancel`, "POST", {}, id),
  );
});

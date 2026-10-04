// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SchedulePanel } from "../../apps/web/src/app/builder/SchedulePanel.js";
import { workspaceRequest } from "../../apps/web/src/app/workspace-api.js";
vi.mock("../../apps/web/src/app/workspace-api.js", () => ({
  workspaceRequest: vi.fn(),
}));
const api = vi.mocked(workspaceRequest),
  id = "00000000-0000-4000-8000-000000000001";
const props = {
  testId: id,
  organizationId: id,
  environments: [{ id, name: "Development" }],
  readOnly: false,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("defaults recurring requests off and validates before saving", async () => {
  api.mockResolvedValue(null);
  render(<SchedulePanel {...props} />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Save schedule",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(
    (screen.getByLabelText("Schedule enabled") as HTMLInputElement).checked,
  ).toBe(false);
  fireEvent.change(screen.getByLabelText("Time zone"), {
    target: { value: "Invalid/Zone" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(api).toHaveBeenCalledTimes(1);
});
it("saves a disabled schedule and exposes pause while Viewer remains read-only", async () => {
  api.mockImplementation(async (_path, method) =>
    method === "GET" ? null : { id, nextRunAt: null, pausedAt: null },
  );
  const { unmount } = render(<SchedulePanel {...props} />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Save schedule",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Pause schedule" })).toBeTruthy(),
  );
  expect(api).toHaveBeenCalledWith(
    "/schedules",
    "POST",
    expect.objectContaining({ testId: id, environmentId: id, enabled: false }),
    id,
  );
  unmount();
  render(<SchedulePanel {...props} readOnly />);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("button", { name: "Save schedule" })).toBeNull();
});

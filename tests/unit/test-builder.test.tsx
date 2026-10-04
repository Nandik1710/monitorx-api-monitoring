// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestEditor } from "../../apps/web/src/app/builder/TestEditor.js";
import { RowsEditor } from "../../apps/web/src/app/builder/RowsEditor.js";
import { TestLibrary } from "../../apps/web/src/app/builder/TestLibrary.js";
import { workspaceRequest } from "../../apps/web/src/app/workspace-api.js";
import { apiTestFieldsSchema } from "../../packages/contracts/src/request-definition.js";

vi.mock("../../apps/web/src/app/workspace-api.js", () => ({
  workspaceRequest: vi.fn(),
}));
const api = vi.mocked(workspaceRequest);
const ids = {
  projectId: "00000000-0000-4000-8000-000000000003",
  collectionId: "00000000-0000-4000-8000-000000000004",
  organizationId: "00000000-0000-4000-8000-000000000002",
};
const environmentId = "00000000-0000-4000-8000-000000000005";
const props = {
  ...ids,
  environments: [{ id: environmentId, name: "Development" }],
  readOnly: false,
  onSaved: vi.fn(async () => {}),
  onCancel: vi.fn(),
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("test builder components", () => {
  it("renders accessible tabs, supports keyboard navigation and clearly labels placeholders", () => {
    render(<TestEditor {...props} />);
    const request = screen.getByRole("tab", { name: "Request" });
    request.focus();
    fireEvent.keyDown(request, { key: "ArrowRight" });
    expect(
      screen.getByRole("tab", { name: "Body" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByLabelText("Body mode")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(screen.getByText(/Scheduling is not available/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText(/Execution history is not available/)).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
  it("saves a disabled test, preserves edits across tabs and never invokes run endpoints", async () => {
    api.mockResolvedValue({});
    render(<TestEditor {...props} />);
    fireEvent.change(screen.getByLabelText("Test name"), {
      target: { value: "Health check" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Assertions" }));
    fireEvent.click(screen.getByRole("button", { name: "Add assertion" }));
    fireEvent.click(screen.getByRole("tab", { name: "Request" }));
    expect((screen.getByLabelText("Test name") as HTMLInputElement).value).toBe(
      "Health check",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith(
      "/tests",
      "POST",
      expect.objectContaining({
        name: "Health check",
        enabled: false,
        assertions: [{ type: "status", severity: "REQUIRED", expected: 200 }],
      }),
      ids.organizationId,
    );
  });
  it("retains edited assertion values across tabs and includes them when saving", async () => {
    api.mockResolvedValue({});
    render(<TestEditor {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "Assertions" }));
    fireEvent.click(screen.getByRole("button", { name: "Add assertion" }));
    const expected = screen.getByLabelText("Assertion 1 expected");
    fireEvent.change(expected, { target: { value: "201,202" } });
    fireEvent.blur(expected);
    fireEvent.click(screen.getByRole("tab", { name: "Request" }));
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith(
      "/tests",
      "POST",
      expect.objectContaining({
        assertions: [
          { type: "status", severity: "REQUIRED", expected: [201, 202] },
        ],
      }),
      ids.organizationId,
    );
  });
  it("blocks invalid configuration locally with a field-oriented error", async () => {
    render(<TestEditor {...props} />);
    fireEvent.change(screen.getByLabelText("URL template"), {
      target: { value: "file:///unsafe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("urlTemplate"),
    );
    expect(api).not.toHaveBeenCalled();
  });
  it("previews masked values without revealing or requesting secret plaintext", async () => {
    api.mockResolvedValue({
      url: "https://example.test/health",
      queryRows: [],
      headerRows: [],
      body: null,
      formRows: [],
      auth: { type: "BEARER", token: "••••••••" },
      variables: { BASE_URL: "https://example.test" },
      secretNames: ["API_TOKEN"],
      notice: "Preview only. No request sent.",
    });
    render(<TestEditor {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "Environment" }));
    fireEvent.change(screen.getByLabelText("Test environment"), {
      target: { value: environmentId },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview variables safely" }),
    );
    await waitFor(() =>
      expect(screen.getByText("API_TOKEN: ••••••••")).toBeTruthy(),
    );
    expect(api).toHaveBeenCalledWith(
      "/tests/preview",
      "POST",
      expect.any(Object),
      ids.organizationId,
    );
  });
  it("keeps Viewer definitions read-only while allowing tab navigation", () => {
    render(<TestEditor {...props} readOnly />);
    expect(screen.queryByRole("button", { name: "Save test" })).toBeNull();
    expect(
      (screen.getByLabelText("URL template") as HTMLInputElement).readOnly,
    ).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Assertions" }));
    expect(screen.queryByRole("button", { name: "Add assertion" })).toBeNull();
  });
  it("submits the saved revision and surfaces conflicting-edit errors", async () => {
    api.mockRejectedValue(
      new Error("This test changed. Reload it before saving your changes."),
    );
    const initial = {
      ...apiTestFieldsSchema.parse({
        projectId: ids.projectId,
        collectionId: ids.collectionId,
        name: "Saved",
        method: "GET",
        urlTemplate: "https://example.test",
      }),
      id: "00000000-0000-4000-8000-000000000006",
      organizationId: ids.organizationId,
      revision: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    render(<TestEditor {...props} initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Reload"),
    );
    expect(api).toHaveBeenCalledWith(
      `/tests/${initial.id}`,
      "PATCH",
      expect.objectContaining({ expectedRevision: 2 }),
      ids.organizationId,
    );
  });
  it("adds query rows with explicit enabled and sensitive flags", () => {
    const onChange = vi.fn();
    render(
      <RowsEditor
        label="Query"
        rows={[]}
        readOnly={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Query" }));
    expect(onChange).toHaveBeenCalledWith([
      { key: "", value: "", enabled: true, sensitive: false },
    ]);
  });
  it("loads a paginated library and hides creation controls for Viewers", async () => {
    api.mockImplementation(async (path) =>
      path.startsWith("/collections") ? { items: [], total: 0 } : { items: [] },
    );
    render(
      <TestLibrary
        organizationId={ids.organizationId}
        projectId={ids.projectId}
        role="VIEWER"
      />,
    );
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Create collection" }),
    ).toBeNull();
    expect(screen.getByText("Collections page 1; 0 total")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  updateMe: vi.fn(),
  refreshMe: vi.fn(),
  setActiveWorkspaceId: vi.fn(),
  existing: [] as Array<{ id: string; name: string }>,
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({
    me: { workspaces: mocks.existing },
    refreshMe: mocks.refreshMe,
    setActiveWorkspaceId: mocks.setActiveWorkspaceId,
  }),
}));
vi.mock("@/app/data", () => ({
  app: { createWorkspace: mocks.createWorkspace, updateMe: mocks.updateMe },
}));
vi.mock("@/auth/AuthShell", () => ({
  AuthShell: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
const { default: OnboardingPage } = await import("@/app/pages/OnboardingPage");
function page() {
  return render(
    <MemoryRouter initialEntries={["/app/onboarding"]}>
      <Routes>
        <Route path="/app/onboarding" element={<OnboardingPage />} />
        <Route path="/app/zev" element={<p>Zev conversation</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.existing = [];
  mocks.createWorkspace.mockResolvedValue({ workspace: { id: "new-ws" } });
  mocks.refreshMe.mockResolvedValue({ workspaces: [{ id: "new-ws" }] });
  mocks.updateMe.mockResolvedValue({});
});
afterEach(cleanup);

describe("quick workspace onboarding", () => {
  it("creates a named workspace and enters the chat without a folder picker", async () => {
    page();
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "My AI team" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Enter your workspace/ }),
    );
    expect(await screen.findByText("Zev conversation")).toBeTruthy();
    expect(mocks.createWorkspace).toHaveBeenCalledWith("My AI team");
    expect(mocks.setActiveWorkspaceId).toHaveBeenCalledWith("new-ws");
  });
  it("opens chat directly for an existing workspace", async () => {
    mocks.existing = [{ id: "existing", name: "Team" }];
    page();
    expect(await screen.findByText("Zev conversation")).toBeTruthy();
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });
  it("retries account refresh without creating a duplicate workspace", async () => {
    mocks.refreshMe.mockResolvedValueOnce(null);
    page();
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "My team" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Enter your workspace/ }),
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: /Enter your workspace/ }),
    );
    expect(await screen.findByText("Zev conversation")).toBeTruthy();
    expect(mocks.createWorkspace).toHaveBeenCalledTimes(1);
  });
  it("keeps a creation failure visible and lets the user retry", async () => {
    mocks.createWorkspace.mockRejectedValueOnce(
      new Error("Could not create workspace"),
    );
    page();
    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "My team" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Enter your workspace/ }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Could not create workspace",
    );
    expect(screen.queryByText("Zev conversation")).toBeNull();
  });
});

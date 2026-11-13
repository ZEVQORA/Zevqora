// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ClarityAudience, ClarityClose } from "../src/marketing/PremiumNarrative";
import { WorkbenchStage, ZevirMap } from "../src/marketing/HomeStory";
import { fireEvent } from "@testing-library/react";

afterEach(() => cleanup());
function mount(component: React.ReactElement) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

describe("outcome-first premium marketing narrative", () => {
  it("states the customer problem in the workbench without inventing revenue or savings", () => {
    const { container } = mount(<WorkbenchStage />);
    expect(container.querySelector("#workbench")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: /cheaper ai means nothing/i })).toBeTruthy();
    expect(screen.getByText(/switching models is easy/i)).toBeTruthy();
    expect(screen.getByText(/illustrative values/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/customer savings|trusted by|saved \$\d/i);
  });

  it("explains four accountable stages; each drives the product preview, review is human", () => {
    mount(<WorkbenchStage />);
    const steps = within(screen.getByRole("list", { name: /how zevqora works/i })).getAllByRole("button");
    expect(steps.map((b) => b.querySelector("b")?.textContent)).toEqual(["Observe", "Challenge", "Verify", "Review"]);
    expect(steps[0].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(steps[2]);
    expect(screen.getByText(/VERIFIED \/ REJECTED \/ INCOMPLETE/)).toBeTruthy();
    fireEvent.click(steps[3]);
    expect(screen.getByText(/human approval before any ship/i)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/not a deployment/i);
  });

  it("explains ZevIR honestly: unknown is not zero, no prompt content, flagged preview", () => {
    mount(<ZevirMap />);
    expect(screen.getByRole("heading", { level: 2, name: /one map of how your ai actually runs/i })).toBeTruthy();
    expect(screen.getByText(/never as zero/i)).toBeTruthy();
    expect(screen.getByText(/not captured by default/i)).toBeTruthy();
    expect(screen.getByText(/feature flag/i)).toBeTruthy();
    expect(screen.getByText(/never changes a verdict/i)).toBeTruthy();
    expect(screen.getByText(/illustrative graph/i)).toBeTruthy();
  });

  it("presents two real target workflow categories without fabricated customers", () => {
    mount(<ClarityAudience />);
    expect(screen.getByRole("heading", { name: /you ship the ai/i })).toBeTruthy();
    expect(screen.getByText(/ai product teams/i)).toBeTruthy();
    expect(screen.getByText(/rag and agent engineers/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /explore a scoped evaluation/i }).getAttribute("href")).toBe("/evaluation");
  });

  it("makes the next step obvious and avoids implying finished customer integrations", () => {
    mount(<ClarityClose />);
    expect(screen.getByRole("heading", { name: /one workload is enough/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /explore an evaluation/i }).getAttribute("href")).toBe("/evaluation");
    expect(screen.getByRole("link", { name: /view current capabilities/i }).getAttribute("href")).toBe("/product");
    expect(screen.getByText(/no customer savings, production deployment or integration is implied/i)).toBeTruthy();
  });
});

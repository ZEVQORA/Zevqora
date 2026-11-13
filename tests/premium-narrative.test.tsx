// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ClarityAudience, ClarityClose, ClarityFlow, ClarityIntro } from "../src/marketing/PremiumNarrative";

afterEach(() => cleanup());
function mount(component: React.ReactElement) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

describe("outcome-first premium marketing narrative", () => {
  it("states the customer problem without inventing revenue or savings", () => {
    const { container } = mount(<ClarityIntro />);
    expect(screen.getByRole("heading", { level: 2, name: /cheaper ai means nothing/i })).toBeTruthy();
    expect(screen.getByText(/switching models is easy/i)).toBeTruthy();
    expect(within(container).getByRole("link", { name: /understand the method/i }).getAttribute("href")).toBe("/how-it-works");
    expect(container.textContent).not.toMatch(/customer savings|trusted by|saved \$\d/i);
  });

  it("explains four distinct accountable optimization stages with outcome gates", () => {
    const { container } = mount(<ClarityFlow />);
    expect(container.querySelector("#how-it-works")).not.toBeNull();
    expect(container.querySelectorAll(".zq-flow-stage")).toHaveLength(4);
    expect(screen.getByText(/VERIFIED \/ REJECTED \/ INCOMPLETE/)).toBeTruthy();
    expect(screen.getByText(/human approval before any ship/i)).toBeTruthy();
    expect(screen.getByText(/current implementation/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /explore the actual product/i }).getAttribute("href")).toBe("/product");
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

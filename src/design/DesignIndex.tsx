import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowUpRight,
  Download,
  LockKeyhole,
  Monitor,
  Smartphone,
  Tablet,
} from "lucide-react";
import { Intro, Kicker, PageTitle } from "@/marketing/Editorial";

type Screen = [string, string, string, string];
const GROUPS: Array<{ name: string; screens: Screen[] }> = [
  {
    name: "Public website",
    screens: [
      [
        "Home",
        "/",
        "/",
        "Cinematic film, product preview, loop, proof, security, Zev and plans.",
      ],
      [
        "Product",
        "/product",
        "/product",
        "Product narrative, interactive surface and capability details.",
      ],
      [
        "How it works",
        "/how-it-works",
        "/how-it-works",
        "Four interactive phases and the complete seven-step workflow.",
      ],
      [
        "Proof",
        "/proof",
        "/proof",
        "Rejected and verified benchmark results, methodology and limitations.",
      ],
      [
        "Pricing",
        "/pricing",
        "/pricing",
        "Billing interval, three plans, comparison table and FAQs.",
      ],
      [
        "Security",
        "/security",
        "/security",
        "Permission boundaries, six controls and exact telemetry payload.",
      ],
      [
        "Team",
        "/team",
        "/team",
        "Founder profiles, company thesis and a direct contact.",
      ],
      [
        "Desktop",
        "/download",
        "/download",
        "Desktop product preview, download and local workflow.",
      ],
      [
        "Privacy",
        "/privacy",
        "/privacy",
        "A readable policy with section navigation.",
      ],
      [
        "Terms",
        "/terms",
        "/terms",
        "A readable agreement with section navigation.",
      ],
      [
        "Page not found",
        "/*",
        "/page-not-found",
        "A clear recovery path with original brand geometry.",
      ],
    ],
  },
  {
    name: "Authentication",
    screens: [
      [
        "Sign in",
        "/login",
        "/login",
        "OAuth, username/email, password and recovery.",
      ],
      [
        "Create account",
        "/signup",
        "/signup",
        "Identity fields, password validation and confirmation.",
      ],
      [
        "Forgot password",
        "/forgot-password",
        "/forgot-password",
        "Email recovery request and delivery state.",
      ],
      [
        "Reset password",
        "/reset-password",
        "/reset-password",
        "New password form or invalid-link state.",
      ],
      [
        "Auth callback",
        "/auth/callback",
        "/auth/callback",
        "Session exchange and a clear loading or error boundary.",
      ],
      [
        "Desktop sign in",
        "/desktop-auth",
        "/desktop-auth",
        "Device authentication handoff with an explicit status.",
      ],
      [
        "Workspace invitation",
        "/invite/:token",
        "/invite/design-preview",
        "Invitation details and invalid-link state.",
      ],
    ],
  },
  {
    name: "Engineering product",
    screens: [
      [
        "Overview",
        "/app",
        "/demo",
        "Metrics, cost comparison, spend allocation and next useful tests.",
      ],
      [
        "Project",
        "/app/project",
        "/demo/project",
        "Repository, call sites, local scan state and sample code browser.",
      ],
      [
        "Opportunities",
        "/app/opportunities",
        "/demo/opportunities",
        "Search, strategy filter, potential estimate and evidence inspector.",
      ],
      [
        "Experiments",
        "/app/experiments",
        "/demo/experiments",
        "Status filters, quality floor, gates and internal benchmark context.",
      ],
      [
        "Changes",
        "/app/changes",
        "/demo/changes",
        "Diff, evidence, review checklist and sample patch export.",
      ],
      [
        "Zev",
        "/app/zev",
        "/demo/zev",
        "Contextual companion, suggested questions and scripted demo chat.",
      ],
    ],
  },
  {
    name: "Workspace",
    screens: [
      [
        "Onboarding",
        "/app/onboarding",
        "/demo/onboarding",
        "Three steps: workspace, evidence and first useful action.",
      ],
      [
        "Workspace dashboard",
        "/app/dashboard",
        "/demo/dashboard",
        "Shared workspace metrics and activity.",
      ],
      [
        "Projects",
        "/app/projects",
        "/demo/projects",
        "Searchable projects and a local demo create form.",
      ],
      [
        "Opportunity detail",
        "/app/opportunities/:id",
        "/demo/opportunities",
        "Inspect source, strategy, samples and quality constraints.",
      ],
      [
        "Experiment detail",
        "/app/experiments/:id",
        "/demo/experiments",
        "Inspect replay cases and every gate decision.",
      ],
      [
        "Runs",
        "/app/runs",
        "/demo/runs",
        "Searchable trace and execution history.",
      ],
      [
        "Evidence",
        "/app/evidence",
        "/demo/evidence",
        "Source, case count and completeness records.",
      ],
      [
        "Runtime",
        "/app/runtime",
        "/demo/runtime",
        "Operation filter, cost, latency and trace metadata.",
      ],
      [
        "Connections",
        "/app/connections",
        "/demo/connections",
        "Kind, scope, revocation boundary and local add preview.",
      ],
      [
        "Reports",
        "/app/reports",
        "/demo/reports",
        "Outcome, case count, benchmark context and report inspection.",
      ],
      [
        "Report detail",
        "/app/reports/:id",
        "/demo/reports",
        "Evidence attached to the report’s decision.",
      ],
      [
        "Usage & billing",
        "/app/usage",
        "/demo/usage",
        "Plan selection preview, credits, projects and retention.",
      ],
      [
        "Team",
        "/app/team",
        "/demo/team",
        "Searchable sample members, roles and local invitation preview.",
      ],
      [
        "Profile settings",
        "/app/settings/profile",
        "/demo/settings",
        "Identity, timezone and notifications.",
      ],
      [
        "Workspace settings",
        "/app/settings/workspace",
        "/demo/settings",
        "Workspace name, retention and opt-in sample capture.",
      ],
      [
        "Security settings",
        "/app/settings/security",
        "/demo/settings",
        "Session inspection and local revocation example.",
      ],
      [
        "Documentation",
        "/app/docs",
        "/demo/docs",
        "Quick start, telemetry, replay and verification.",
      ],
      [
        "Interface states",
        "Shared surfaces",
        "/demo/states",
        "Loading, empty, offline and permission boundaries.",
      ],
    ],
  },
  {
    name: "Administration",
    screens: [
      [
        "Control centre",
        "/admin",
        "/demo/admin",
        "Operational metrics, configured controls and audit history.",
      ],
      [
        "Users",
        "/admin/users",
        "/demo/admin/users",
        "Search and inspect sample user records.",
      ],
      [
        "User detail",
        "/admin/users/:id",
        "/demo/admin/users",
        "Profile, plan, workspace and account status inspector.",
      ],
      [
        "Workspaces",
        "/admin/workspaces",
        "/demo/admin/workspaces",
        "Owner, plan, members and workspace status.",
      ],
      [
        "Workspace detail",
        "/admin/workspaces/:id",
        "/demo/admin/workspaces",
        "Sample workspace record inspector.",
      ],
      [
        "Pricing & plans",
        "/admin/pricing",
        "/demo/admin/pricing",
        "Reference prices, replay limits and included credits.",
      ],
      [
        "Website content",
        "/admin/content",
        "/demo/admin/content",
        "Local editorial form and save feedback.",
      ],
      [
        "Feature flags",
        "/admin/flags",
        "/demo/admin/flags",
        "Accessible local switches and feature descriptions.",
      ],
      [
        "Model pricing",
        "/admin/model-pricing",
        "/demo/admin/model-pricing",
        "Historical model-price snapshot with explicit context.",
      ],
      [
        "Audit log",
        "/admin/audit",
        "/demo/admin/audit",
        "Action, actor, resource, time and outcome.",
      ],
      [
        "Admins",
        "/admin/admins",
        "/demo/admin/admins",
        "Administrative role and access inspector.",
      ],
    ],
  },
];
export default function DesignIndex() {
  const [group, setGroup] = useState("Public website"),
    [route, setRoute] = useState("/"),
    [device, setDevice] = useState("Desktop");
  const screens = GROUPS.find((g) => g.name === group)!.screens;
  const total = GROUPS.reduce((n, g) => n + g.screens.length, 0);
  return (
    <>
      <PageTitle title="All screens" />
      <Intro
        kicker={`${total} SCREEN DESIGNS / ONE BRAND SYSTEM`}
        title={
          <>
            One brand.
            <br />
            <span>Every screen.</span>
          </>
        }
        body="Explore the full Zevqora experience. Public pages and authentication use the real frontend. Workspace and admin previews use explicitly labelled sample data."
      >
        {import.meta.env.VITE_DESIGN_PREVIEW === "true" && (
          <div className="z-actions">
            <a
              className="z-button z-button-ink"
              href="/downloads/zevqora-frontend-redesign.zip"
              download
            >
              <Download size={15} />
              Download source ZIP
            </a>
            <a
              className="z-button z-button-line"
              href="/downloads/zevqora-frontend-redesign.patch"
              download
            >
              Download change patch
              <ArrowUpRight size={15} />
            </a>
          </div>
        )}
      </Intro>
      <section className="z-section">
        <div className="z-wrap">
          <div
            className="design-category-tabs"
            role="group"
            aria-label="Screen category"
          >
            {GROUPS.map((g) => (
              <button
                type="button"
                key={g.name}
                aria-pressed={group === g.name}
                onClick={() => setGroup(g.name)}
              >
                {g.name}
                <span>{g.screens.length}</span>
              </button>
            ))}
          </div>
          <div className="design-screen-list">
            {screens.map(([name, production, preview, description]) => (
              <div className="design-screen-row" key={name}>
                <div>
                  <h2>{name}</h2>
                  <code>{production}</code>
                </div>
                <p>{description}</p>
                <button
                  type="button"
                  onClick={() => {
                    setRoute(preview);
                    document
                      .getElementById("device-preview")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Preview
                  <ArrowUpRight size={13} />
                </button>
                <Link to={preview} aria-label={`Open ${name} in full page`}>
                  <ArrowUpRight size={16} />
                </Link>
              </div>
            ))}
          </div>
          <p className="design-note">
            <LockKeyhole size={12} />
            Live /app and /admin routes retain their existing authentication and
            server permissions. Previews are separate from production data.
          </p>
        </div>
      </section>
      <section className="z-section design-device-section" id="device-preview">
        <div className="z-wrap">
          <div className="z-section-head">
            <div>
              <Kicker>RESPONSIVE CANVAS</Kicker>
              <h2 className="z-heading">
                See the screen
                <br />
                at its own scale.
              </h2>
            </div>
            <div className="design-device-controls">
              {[
                [Monitor, "Desktop"],
                [Tablet, "Tablet"],
                [Smartphone, "Mobile"],
              ].map(([Icon, label]) => {
                const I = Icon as typeof Monitor;
                return (
                  <button
                    type="button"
                    key={String(label)}
                    aria-pressed={device === label}
                    onClick={() => setDevice(String(label))}
                  >
                    <I size={15} />
                    {String(label)}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="design-route-label" htmlFor="preview-route">
            Preview route
            <select
              id="preview-route"
              value={route}
              onChange={(e) => setRoute(e.target.value)}
            >
              {Array.from(
                new Map(
                  GROUPS.flatMap((g) =>
                    g.screens.map(([name, , p]) => [p, name] as const),
                  ),
                ).entries(),
              ).map(([p, name]) => (
                <option value={p} key={p}>
                  {name} — {p}
                </option>
              ))}
            </select>
          </label>
          <div className={`design-device-stage ${device.toLowerCase()}`}>
            <iframe
              title={`${device} preview of ${route}`}
              src={route}
              loading="lazy"
            />
          </div>
          <div className="design-preview-bottom">
            <span>
              {device === "Mobile"
                ? "390 × 844"
                : device === "Tablet"
                  ? "768 × 900"
                  : "Responsive width × 850"}{" "}
              / native iframe viewport
            </span>
            <Link to={route}>
              Open full page
              <ArrowUpRight size={13} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

import { useEffect, useState } from "react";
import { ArrowUpRight, Download, Monitor } from "lucide-react";
import { Link } from "react-router";
import { getConfigSync, loadConfig } from "@/lib/config";
import { EndCta, Intro, Kicker, PageTitle, Rise } from "./Editorial";
import { ProductPreview } from "./ProductPreview";

export default function DownloadPage() {
  const [url, setUrl] = useState(getConfigSync().desktopDownloadUrl);
  useEffect(() => {
    let active = true;
    loadConfig().then((c) => {
      if (active) setUrl(c.desktopDownloadUrl);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <PageTitle title="Desktop" />
      <Intro
        kicker="ZEVQORA DESKTOP"
        title={
          <>
            The same intelligence.
            <br />
            <span>Closer to your code.</span>
          </>
        }
        body="Your workspace, your account, your engineering loop. The desktop app adds direct repository access and isolated Git worktrees for a change you can review."
      >
        <div className="z-actions">
          <a href={url} className="z-button z-button-blue">
            <Download size={16} />
            Download for Windows
          </a>
          <Link to="/product" className="z-button z-button-line">
            Explore the product
            <ArrowUpRight size={15} />
          </Link>
        </div>
        <p className="plan-reference">
          <Monitor size={12} className="mr-2 inline" />
          Windows 10/11 · NSIS installer · local engine included
          <br />
          macOS build not published yet. Use the browser on other platforms.
        </p>
      </Intro>
      <div className="z-wrap">
        <Rise className="download-stage">
          <ProductPreview />
        </Rise>
      </div>
      <section className="z-section" style={{ marginTop: 80 }}>
        <div className="z-wrap">
          <Kicker>FROM YOUR FOLDER TO YOUR REVIEW</Kicker>
          <h2 className="z-heading" style={{ marginTop: 24 }}>
            Local where it matters.
            <br />
            Connected where it helps.
          </h2>
          <div className="feature-rows" style={{ marginTop: 40 }}>
            {[
              [
                "01",
                "Choose your repository.",
                "Read-only scans detect AI call sites on your machine. Secret-like files are skipped. Nothing is uploaded during a scan.",
              ],
              [
                "02",
                "Bring the right evidence.",
                "Import representative execution traces and baseline outputs. Replay samples are bounded, sanitized and tied to the workload.",
              ],
              [
                "03",
                "Let the gates decide.",
                "Platform replay uses your ZEVQORA account, plan and Zev credit. Model credentials stay on the server; a local key is optional.",
              ],
              [
                "04",
                "Inspect the worktree.",
                "A candidate patch lands in an isolated worktree and branch. Review the diff, run your tests and open the pull request yourself.",
              ],
            ].map(([n, t, b]) => (
              <div className="feature-row" key={n}>
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <EndCta />
    </>
  );
}

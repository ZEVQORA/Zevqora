import { ArrowDown } from "lucide-react";
import { Zev } from "@/brand/Zev";
import { AskZev } from "./askzev/AskZev";

/**
 * Scene 2 — a calm, centered welcome: the official Zev, one greeting and one
 * composer. This is the ONLY place Ask Zev is mounted; past this scene the
 * same instance docks bottom-right and returns here on scroll up.
 */
export function AskZevStage() {
  return (
    <section className="zev-stage" id="ask-zev" aria-labelledby="zev-stage-title">
      <div className="zev-stage-inner">
        <div className="zev-stage-avatar" aria-hidden>
          <Zev view="pose-waving" height={132} alt="" />
        </div>
        <h2 id="zev-stage-title">Hello, any questions?</h2>
        <p className="zev-stage-sub">Ask Zev about ZEVQORA.</p>
        <div className="zev-stage-slot">
          <AskZev />
        </div>
        <a href="#workbench" className="zev-stage-next">
          <span>See how ZEVQORA works</span>
          <ArrowDown size={16} aria-hidden />
        </a>
      </div>
    </section>
  );
}

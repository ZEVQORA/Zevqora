import { type ReactNode } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useSeo } from "@/lib/seo";
import { EngineEnd } from "./EngineEnd";
import { motion, useReducedMotion } from "motion/react";

const DEFAULT_DESCRIPTION =
  "Verified AI optimization: understand how an AI system executes, find expensive or unreliable paths, and prove which changes are worth shipping.";

/** Title, description, canonical URL and social tags for a public page (skipped inside admin previews). */
export function PageTitle({
  title,
  description = DEFAULT_DESCRIPTION,
  jsonLd,
}: {
  title: string;
  description?: string;
  jsonLd?: Record<string, unknown>;
}) {
  const { pathname } = useLocation();
  useSeo({ title: `${title} — ZEVQORA`, description, path: pathname, jsonLd });
  return null;
}
export function Rise({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -40px 0px" }}
      transition={{ duration: 0.65, delay, ease: [0.2, 0.7, 0.1, 1] }}
    >
      {children}
    </motion.div>
  );
}
export function Kicker({
  children,
  number,
}: {
  children: ReactNode;
  number?: string;
}) {
  return (
    <p className="z-kicker">
      {number && <span>{number} /</span>}
      <i />
      {children}
    </p>
  );
}
export function TextLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="z-text-link" to={to}>
      {children}
      <ArrowUpRight size={16} />
    </Link>
  );
}
export function Intro({
  kicker,
  title,
  body,
  children,
  className = "",
}: {
  kicker: string;
  title: ReactNode;
  body: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`z-page-intro z-wrap ${className}`}>
      <Rise>
        <Kicker>{kicker}</Kicker>
        <h1 className="z-display">{title}</h1>
        <p className="z-lede">{body}</p>
        {children}
      </Rise>
    </section>
  );
}
export function FAQ({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="z-faq">
      {items.map(([q, a]) => (
        <details key={q}>
          <summary>
            {q}
            <Plus size={18} />
          </summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}
export function EndCta() {
  return <EngineEnd />;
}

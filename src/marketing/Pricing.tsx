import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowUpRight,
  Check,
  Command,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import { planPrice, usePlans } from "@/lib/site";
import { useSession } from "@/lib/session";
import type { Plan } from "@/lib/types";
import { RollingPrice } from "@/brand/RollingPrice";
import { Kicker } from "./Editorial";

export function BillingToggle({
  annual,
  onChange,
  discount = 20,
}: {
  annual: boolean;
  onChange: (v: boolean) => void;
  discount?: number;
}) {
  return (
    <div className="billing-toggle" role="group" aria-label="Billing interval">
      {[false, true].map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={annual === v}
          onClick={() => onChange(v)}
        >
          {v ? "Yearly" : "Monthly"}
          {v && discount > 0 && (
            <>
              {" "}
              <span>Save {discount}%</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

export function PlanCard({
  plan,
  annual,
  currentPlanId,
}: {
  plan: Plan;
  annual: boolean;
  currentPlanId?: string | null;
}) {
  const price = planPrice(plan, annual);
  const { status } = useSession();
  const navigate = useNavigate();
  const interval = annual ? "annual" : "monthly";
  const target =
    status === "signed_in"
      ? `/app/usage?plan=${plan.id}&interval=${interval}`
      : `/signup?plan=${plan.id}&interval=${interval}`;
  const Icon = plan.contact_sales
    ? ShieldCheck
    : plan.popular
      ? Command
      : Layers3;
  const savings = (planPrice(plan, false) - price) * 12;
  return (
    <article className={`plan-card ${plan.popular ? "popular" : ""}`}>
      <div className="plan-card-top">
        <span className="plan-icon">
          <Icon size={19} />
        </span>
        {plan.popular && <span className="plan-badge">Most popular</span>}
      </div>
      <h3>
        {plan.name}
        {currentPlanId === plan.id && (
          <span className="plan-current">Current plan</span>
        )}
      </h3>
      <p>{plan.tagline}</p>
      <div className="plan-price">
        {plan.contact_sales && <span className="plan-from">from</span>}
        <RollingPrice value={price} />
        <small>/ month</small>
      </div>
      <div className="plan-billing-note">
        <span>
          {annual
            ? `$${(price * 12).toFixed(2)} billed yearly`
            : "Billed monthly"}
        </span>
        <span
          className={
            annual && savings > 0 ? "plan-savings is-visible" : "plan-savings"
          }
        >
          {annual && savings > 0
            ? `Save $${savings.toFixed(2)} a year`
            : "Switch to yearly for more value"}
        </span>
      </div>
      {plan.contact_sales ? (
        <a className="z-button z-button-line" href={plan.cta_href}>
          {plan.cta_label}
          <ArrowUpRight size={16} />
        </a>
      ) : (
        <button
          type="button"
          className={`z-button ${plan.popular ? "z-button-blue" : "z-button-line"}`}
          onClick={() => navigate(target)}
          aria-label={`${currentPlanId === plan.id ? "Manage" : "Choose"} ${plan.name} · ${interval}`}
        >
          {currentPlanId === plan.id ? "Manage plan" : plan.cta_label}
          <ArrowUpRight size={16} />
        </button>
      )}
      <div className="plan-feature-label">
        {plan.contact_sales
          ? "Built around your team"
          : "Your workspace includes"}
      </div>
      <ul>
        {plan.features.map((feature) => (
          <li key={feature}>
            <Check size={14} />
            {feature}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function PricingGrid({
  heading = true,
  currentPlanId,
  page = false,
}: {
  heading?: boolean;
  currentPlanId?: string | null;
  page?: boolean;
}) {
  const [annual, setAnnual] = useState(false);
  const { plans, isReference } = usePlans({ referenceFallback: true });
  const visible = (plans || []).filter((plan) => plan.visible);
  const discount = Math.max(
    0,
    ...visible.map((plan) => plan.annual_discount_pct),
  );
  const Heading = page ? "h1" : "h2";
  return (
    <div
      className={`z-wrap pricing-surface ${page ? "pricing-full" : "pricing-compact"}`}
    >
      <div className="pricing-title">
        <div>
          {heading && (
            <>
              <Kicker>
                {page ? "STRAIGHTFORWARD PRICING" : "PLANS THAT GIVE YOU ROOM"}
              </Kicker>
              <Heading className="z-heading">
                {page ? (
                  <>
                    Simple plans.
                    <br />
                    <span>Room to grow.</span>
                  </>
                ) : (
                  <>
                    A lighter bill.
                    <br />
                    <span>A little more possibility.</span>
                  </>
                )}
              </Heading>
              <p className="z-body">
                One workload or your whole team. Start where you are.
              </p>
            </>
          )}
        </div>
        <div className="pricing-billing-control">
          <BillingToggle
            annual={annual}
            onChange={setAnnual}
            discount={discount}
          />
          <p>
            {annual
              ? "A year to build. A better monthly rate."
              : "Choose the rhythm that works for you."}
          </p>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {annual
          ? "Yearly billing selected. Prices show the monthly equivalent."
          : "Monthly billing selected."}
      </p>
      <div className="plans-grid">
        {visible.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            annual={annual}
            currentPlanId={currentPlanId}
          />
        ))}
      </div>
      <div className="pricing-bottom-note">
        <span>
          <ShieldCheck size={14} /> Every plan keeps quality in the decision.
        </span>
        {!page && (
          <Link to="/pricing">
            Compare all plans <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
      {isReference && (
        <p className="plan-reference">
          Repository plan reference. Your account confirms the current price
          before checkout.
        </p>
      )}
      <p className="plans-fineprint">
        Zev credit covers provider cost during replay and resets each billing
        period. Analysis, telemetry and reports do not use replay credit.
        Subscriptions renew until cancelled.
      </p>
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleDot,
  GitBranch,
  Github,
  Layers3,
  MessageCircle,
  Play,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Aurora } from "@/brand/Aurora";
import { ZevqoraMark } from "@/brand/ZevqoraMark";
import { useSession } from "@/lib/session";
import { PageTitle } from "./Editorial";
import { SupportZevLauncher } from "./SupportZevLauncher";

const steps = [
  {
    label: "Connect",
    title: "Your stack. One clear picture.",
    text: "Bring your repository and runtime evidence together. See where your AI calls happen and what they cost.",
    Icon: Github,
  },
  {
    label: "Understand",
    title: "Less noise. More insight.",
    text: "Find expensive paths, repeated work, and opportunities. Ask Zev to help you make sense of the evidence.",
    Icon: Layers3,
  },
  {
    label: "Verify",
    title: "Move forward with confidence.",
    text: "Replay a candidate against your quality gates. Review the results before deciding what to ship.",
    Icon: ShieldCheck,
  },
];

function WorkspacePreview() {
  const [active, setActive] = useState(0);
  const content = [
    [
      "Understand your AI spend",
      "Connect your first project to turn execution data into a clearer picture.",
      "Connect a repository",
    ],
    [
      "A second pair of eyes",
      "Ask Zev about setup, your workspace, or the next step in your analysis.",
      "Meet your AI helpdesk",
    ],
    [
      "Evidence before changes",
      "Compare a candidate with your baseline, then review the quality gates.",
      "Explore verification",
    ],
  ];
  return (
    <div className="nova-preview">
      <div className="nova-preview-chrome">
        <div>
          <i />
          <i />
          <i />
        </div>
        <span>YOUR ZEVQORA WORKSPACE</span>
        <span className="nova-demo-label">Product preview</span>
      </div>
      <div className="nova-preview-body">
        <aside>
          <ZevqoraMark height={28} />
          <span className="nova-preview-workspace">
            My workspace <ChevronRight size={12} />
          </span>
          {[
            { name: "Overview", Icon: Layers3 },
            { name: "Ask Zev", Icon: MessageCircle },
            { name: "Verification", Icon: ShieldCheck },
          ].map(({ name, Icon }, i) => (
            <button
              key={name}
              className={active === i ? "active" : ""}
              onClick={() => setActive(i)}
            >
              <Icon size={15} />
              {name}
            </button>
          ))}
          <small>
            <CircleDot size={12} /> Your next idea starts here
          </small>
        </aside>
        <div className="nova-preview-content">
          <div className="nova-preview-breadcrumb">
            Workspace <ChevronRight size={12} />{" "}
            {["Overview", "Ask Zev", "Verification"][active]}
          </div>
          <span className="nova-mini-kicker">
            A LITTLE CLARITY GOES A LONG WAY
          </span>
          <h3>
            {content[active][0]}
            <span>.</span>
          </h3>
          <p>{content[active][1]}</p>
          <div className="nova-preview-connect">
            <div className="nova-icon-box">
              {active === 1 ? (
                <Sparkles />
              ) : active === 2 ? (
                <ShieldCheck />
              ) : (
                <Github />
              )}
            </div>
            <b>{content[active][2]}</b>
            <span>Everything you need. A little less friction.</span>
            <Link to={active === 1 ? "/app/zev" : "/signup"}>
              Get started <ArrowRight size={14} />
            </Link>
          </div>
          <div className="nova-preview-bottom">
            <span>
              <Check size={13} /> Your workspace, organized
            </span>
            <span>
              <ShieldCheck size={13} /> You stay in control
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { status } = useSession();
  const reduced = useReducedMotion();
  const target = status === "signed_in" ? "/app" : "/signup";
  return (
    <>
      <PageTitle
        title="Make AI lighter."
        description="Understand your AI, verify better decisions, and build with less friction. Meet the new ZEVQORA workspace."
      />
      <section className="nova-hero">
        <Aurora />
        <motion.div
          className="nova-hero-content"
          initial={reduced ? false : { opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          <Link to="/product" className="nova-announcement">
            <span className="nova-live-dot" /> A lighter way to build with AI{" "}
            <ChevronRight size={14} />
          </Link>
          <h1 aria-label="Make AI lighter.">
            Make AI
            <br />
            Lighter<span>.</span>
          </h1>
          <p>
            Big ideas. Less friction.
            <br className="nova-mobile-break" /> A clearer path from insight to
            impact.
          </p>
          <div className="nova-hero-actions">
            <Link
              to={target}
              className="nova-primary"
              data-cta="hero-get-started"
            >
              Explore ZEVQORA <ArrowUpRight size={20} />
            </Link>
            <a href="#workspace" className="nova-secondary">
              <span>
                <Play size={12} fill="currentColor" />
              </span>{" "}
              See how it works
            </a>
          </div>
          <div className="nova-hero-note">
            <span>MEASURE</span>
            <i />
            <span>REPLAY</span>
            <i />
            <span>VERIFY</span>
            <i />
            <span>OPTIMIZE</span>
          </div>
        </motion.div>
        <div className="nova-hero-bottom">
          <span>LESS COMPLEXITY. MORE POSSIBILITY.</span>
          <a href="#workspace" aria-label="Explore the workspace">
            <ArrowDown size={16} />
          </a>
          <span>
            BUILT FOR WHAT’S NEXT <span className="nova-live-dot" />
          </span>
        </div>
      </section>
      <section className="nova-ecosystem">
        <span>DESIGNED TO FIT YOUR AI STACK</span>
        <div>
          <b>
            <span className="nova-provider-symbol">◉</span> OpenAI
          </b>
          <b>
            <span className="nova-provider-symbol">✳</span> Anthropic
          </b>
          <b>
            <span className="nova-provider-symbol">✧</span> Gemini
          </b>
          <b>
            <Github size={23} /> GitHub
          </b>
          <b>
            <GitBranch size={23} /> OpenTelemetry
          </b>
        </div>
        <small>
          Connect supported evidence from the tools you already use.
        </small>
      </section>
      <section id="workspace" className="nova-section nova-workspace-section">
        <div className="nova-section-heading">
          <div>
            <span className="nova-kicker">
              <span /> MEET YOUR NEW WORKSPACE
            </span>
            <h2>
              Complex underneath.
              <br />
              <span>Effortless on the surface.</span>
            </h2>
          </div>
          <p>
            Your projects, insights, and next steps.
            <br />
            Finally, in a space that makes sense.
          </p>
        </div>
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 45 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.8 }}
        >
          <WorkspacePreview />
        </motion.div>
      </section>
      <section className="nova-section nova-method">
        <div className="nova-section-heading">
          <div>
            <span className="nova-kicker">
              <span /> FROM SIGNAL TO CONFIDENCE
            </span>
            <h2>
              Less guesswork.
              <br />
              <span>Three clear steps.</span>
            </h2>
          </div>
          <Link to="/how-it-works" className="nova-text-link">
            Inside the technology <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="nova-step-grid">
          {steps.map(({ label, title, text, Icon }, i) => (
            <motion.article
              key={label}
              initial={reduced ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
            >
              <div className="nova-step-top">
                <span>
                  0{i + 1} / {label.toUpperCase()}
                </span>
                <Icon size={22} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
              <div className={`nova-step-art art-${i}`} aria-hidden>
                <span />
                <span />
                <span />
                <Zap size={20} />
              </div>
            </motion.article>
          ))}
        </div>
      </section>
      <section className="nova-section nova-zev-section">
        <div className="nova-zev-orb" aria-hidden>
          <div>
            <ZevqoraMark height={72} />
          </div>
          <i />
          <i />
          <i />
        </div>
        <div>
          <span className="nova-kicker">
            <span /> A LITTLE HELP GOES A LONG WAY
          </span>
          <h2>
            Meet Zev.
            <br />
            <span>Consider it handled.</span>
          </h2>
          <p>
            Your AI helpdesk for getting started, finding your way, and
            understanding what comes next. Less searching. More doing.
          </p>
          <Link
            to={
              status === "signed_in" ? "/app/zev" : "/signup?next=%2Fapp%2Fzev"
            }
            className="nova-text-link"
          >
            Say hello to Zev <ArrowUpRight size={17} />
          </Link>
        </div>
      </section>
      <section className="nova-final">
        <Aurora />
        <div>
          <span className="nova-kicker">ROOM FOR YOUR NEXT BIG IDEA</span>
          <h2>
            Go further.
            <br />
            Travel lighter<span>.</span>
          </h2>
          <Link to={target} className="nova-primary">
            Get started with ZEVQORA <ArrowUpRight size={19} />
          </Link>
          <p>Your next chapter starts with a little clarity.</p>
        </div>
      </section>
      <SupportZevLauncher />
    </>
  );
}

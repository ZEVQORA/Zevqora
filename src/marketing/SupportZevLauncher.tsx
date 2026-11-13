import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ArrowUp, ArrowUpRight, Sparkles, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";

export function SupportZevLauncher({
  afterHero = false,
}: {
  afterHero?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pastHero, setPastHero] = useState(!afterHero);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"public_faq" | "generative">("public_faq");
  const [lines, setLines] = useState<
    Array<{ role: "user" | "assistant"; text: string }>
  >([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const dismiss = () => {
    setOpen(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  };
  useEffect(() => {
    if (!afterHero) return;
    const update = () => setPastHero(window.scrollY > window.innerHeight * 0.6);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [afterHero]);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.setTimeout(() => trigger.current?.focus(), 0);
      }
      if (event.key !== "Tab") return;
      const items = panel.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled])",
      );
      if (!items?.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open]);
  useEffect(() => {
    scroll.current?.scrollTo?.({
      top: scroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [lines, busy]);
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setLines((current) => [...current, { role: "user", text: text.trim() }]);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const response = await api<{
        answer: string;
        answer_mode: "public_faq" | "generative";
      }>("/api/support/message", {
        method: "POST",
        auth: false,
        body: { message: text.trim() },
      });
      setMode(response.answer_mode);
      setLines((current) => [
        ...current,
        { role: "assistant", text: response.answer },
      ]);
    } catch (err) {
      setError(
        errorMessage(
          err,
          "Zev is unavailable right now. Try again or contact the team.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };
  if (!pastHero && !open) return null;
  return (
    <div className="nova-support">
      {!open && (
        <button
          ref={trigger}
          className="nova-support-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={false}
          aria-label="Open Ask Zev public support"
          onClick={() => setOpen(true)}
        >
          <Sparkles size={23} />
          <span>Ask Zev</span>
          <i />
        </button>
      )}
      {open && (
        <section
          className="nova-support-panel"
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <header>
            <div className="nova-support-avatar">
              <Sparkles size={19} />
            </div>
            <div>
              <h2 id={titleId}>Hey, I’m Zev.</h2>
              <p>Your ZEVQORA helpdesk</p>
            </div>
            <button
              ref={close}
              type="button"
              onClick={dismiss}
              aria-label="Close support"
            >
              <X size={18} />
            </button>
          </header>
          <div
            className="nova-support-messages"
            ref={scroll}
            aria-live="polite"
          >
            <p className="nova-support-intro">
              A little clarity? I’m here for that.
              <br />
              How can I help you get started?
            </p>
            {!lines.length && (
              <div className="nova-support-prompts">
                {[
                  "How do I get started?",
                  "Connect my GitHub repository",
                  "How does verification work?",
                ].map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => void send(text)}
                  >
                    {text}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            )}
            {lines.map((line, i) => (
              <p key={i} className={`nova-support-message ${line.role}`}>
                {line.text}
              </p>
            ))}
            {busy && <p className="nova-support-thinking">Zev is thinking…</p>}
            {error && (
              <p role="alert" className="nova-support-error">
                {error}
              </p>
            )}
          </div>
          <form onSubmit={submit}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              maxLength={1500}
              placeholder="Ask about ZEVQORA…"
              aria-label="Ask Zev a question"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send question"
            >
              <ArrowUp size={16} />
            </button>
          </form>
          <footer>
            <span>
              {mode === "generative"
                ? "AI answers · Check important details"
                : "Product guide · FAQ answers"}
            </span>
            <Link to="/app/zev" onClick={dismiss}>
              Open workspace <ArrowUpRight size={10} />
            </Link>
          </footer>
        </section>
      )}
    </div>
  );
}

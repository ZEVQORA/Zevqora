import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ArrowUp, ArrowUpRight, MessageCircle, RotateCcw, X } from "lucide-react";
import { ZevqoraMark } from "@/brand/ZevqoraMark";
import { api, errorMessage } from "@/lib/api";

const PROMPTS = ["How do I get started?", "How does verification work?", "What can I connect?"];
const ANSWER_ROUTE = /(\/(?:signup|login|forgot-password|pricing|proof|product|app\/(?:connections|docs|zev|usage|settings|team))\b)/g;

export function openZevSupport() {
  window.dispatchEvent(new Event("zevqora:open-support"));
}

export function SupportZevLauncher() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState("");
  const [mode, setMode] = useState<"public_faq" | "generative">("public_faq");
  const [lines, setLines] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("zevqora:open-support", show);
    return () => window.removeEventListener("zevqora:open-support", show);
  }, []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.querySelectorAll<HTMLElement>(".marketing-app > header, .marketing-app > main, .marketing-app > footer"));
    const inert = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    close.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab") return;
      const items = panel.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled])");
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handle);
    return () => {
      background.forEach((element, i) => { element.inert = inert[i]; });
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handle);
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
      else trigger.current?.focus();
    };
  }, [open]);
  useEffect(() => {
    scroll.current?.scrollTo?.({ top: scroll.current.scrollHeight, behavior: "instant" });
  }, [lines, busy, error]);

  async function send(text: string, retry = false) {
    const message = text.trim();
    if (!message || sending.current) return;
    sending.current = true;
    if (!retry) setLines((current) => [...current, { role: "user", text: message }]);
    setInput(""); setBusy(true); setError(""); setFailed("");
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await api<{ answer: string; answer_mode: "public_faq" | "generative" }>("/api/support/message", {
        method: "POST", auth: false, body: { message }, signal: controller.signal,
      });
      if (!response?.answer?.trim()) throw new Error("Zev couldn’t answer just now. Please try again.");
      setMode(response.answer_mode);
      setLines((current) => [...current, { role: "assistant", text: response.answer }]);
    } catch (err) {
      setFailed(message);
      setError(controller.signal.aborted ? "That took longer than expected. Please try again." : errorMessage(err, "Zev is unavailable. Please try again."));
    } finally {
      window.clearTimeout(timeout); sending.current = false; setBusy(false); request.current = null;
    }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(input); }

  return (
    <div className="zev-support">
      <button ref={trigger} className="zev-support-trigger" type="button" hidden={open}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={`${titleId}-panel`}
        aria-label="Open Ask Zev public support" onClick={() => setOpen(true)}>
        <MessageCircle size={20} /><span>Ask Zev</span>
      </button>
      {open && <>
        <button className="zev-support-backdrop" aria-label="Close Zev support" tabIndex={-1} onClick={() => setOpen(false)} />
        <section className="zev-support-panel" id={`${titleId}-panel`} ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-scope`}>
          <header>
            <div className="zev-support-avatar"><ZevqoraMark height={25} /></div>
            <div><h2 id={titleId}>Ask Zev</h2><p>{mode === "generative" ? "AI assistant" : "ZEVQORA product guide"}</p></div>
            <button ref={close} type="button" onClick={() => setOpen(false)} aria-label="Close support"><X size={20} /></button>
          </header>
          <div className="zev-support-messages" ref={scroll} role="log" aria-live="polite" aria-relevant="additions text" aria-busy={busy}>
            {!lines.length && <div className="zev-support-welcome">
              <span className="polished-eyebrow">A LITTLE CLARITY</span>
              <h3>Where can I help?</h3>
              <p>Ask about getting started, connecting your stack, or understanding the evidence.</p>
              <div className="zev-support-prompts">{PROMPTS.map((text) => <button key={text} type="button" onClick={() => void send(text)}>{text}<ArrowUpRight size={16} /></button>)}</div>
            </div>}
            {lines.map((line, i) => <div key={i} className={`zev-support-message ${line.role}`}><span>{line.role === "user" ? "You" : "Zev"}</span><p>{line.role === "user" ? line.text : line.text.split(ANSWER_ROUTE).map((part, index) => index % 2 ? <Link key={index} to={part} onClick={() => setOpen(false)}>{part}</Link> : part)}</p></div>)}
            {busy && <p className="zev-support-thinking" role="status"><i /><i /><i /><span>Zev is finding an answer…</span></p>}
            {error && <div className="zev-support-error" role="alert"><p>{error}</p><button type="button" onClick={() => void send(failed, true)}><RotateCcw size={14} /> Try again</button></div>}
          </div>
          <form onSubmit={submit}>
            <label className="sr-only" htmlFor={`${titleId}-question`}>Ask Zev a question</label>
            <textarea id={`${titleId}-question`} value={input} onChange={(event) => setInput(event.target.value)} maxLength={1500} rows={2} placeholder="Ask about ZEVQORA…"
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input); } }} />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send question"><ArrowUp size={20} /></button>
          </form>
          <footer><p id={`${titleId}-scope`}>{mode === "generative" ? "AI answers · Check important details" : "Product guide · FAQ answers"}. No account access.</p><Link to="/app/zev" onClick={() => setOpen(false)}>Open workspace <ArrowUpRight size={13} /></Link></footer>
        </section>
      </>}
    </div>
  );
}

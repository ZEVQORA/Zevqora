import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  BookOpen,
  Check,
  Copy,
  Github,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ProductFrame } from "../Frame";
import { useProduct } from "../store";
import { useSession } from "@/lib/session";
import { engineErrorMessage } from "../engine";
import type { ChatLine } from "../types";

const suggestions = [
  {
    title: "Connect my project",
    description: "Bring your GitHub repo or server.",
    prompt: "How do I connect my GitHub repository or server to ZEVQORA?",
    Icon: Github,
  },
  {
    title: "Show me around",
    description: "Find your way. Make yourself at home.",
    prompt:
      "I am new to ZEVQORA. Walk me through the workspace and help me get started.",
    Icon: BookOpen,
  },
  {
    title: "Help me understand",
    description: "Turn AI execution data into clarity.",
    prompt:
      "How do I understand my AI costs and verify an optimization safely?",
    Icon: Sparkles,
  },
];

export default function ZevView() {
  const { engine, selected, model, refreshProductData, setZevState } =
    useProduct();
  const { me, session } = useSession();
  const rawName =
    me?.profile.display_name ||
    session?.user.user_metadata?.full_name ||
    me?.profile.username ||
    session?.user.email?.split("@")[0] ||
    "there";
  const name = String(rawName).trim().split(/\s+/)[0];
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const controller = useRef(0);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [lines, busy]);
  useEffect(() => {
    setLines([]);
    setError("");
    controller.current += 1;
  }, [selected?.id, session?.user.id]);
  const submit = async (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    const requestId = controller.current;
    const next = [
      ...lines,
      { id: crypto.randomUUID(), role: "user" as const, content: value },
    ];
    setLines(next);
    setInput("");
    setBusy(true);
    setError("");
    setZevState("thinking");
    try {
      const response = await engine.chat(
        selected?.id || null,
        next.map((l) => ({ role: l.role, content: l.content })).slice(-16),
        model || undefined,
      );
      if (requestId !== controller.current) return;
      setLines((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: response.message,
          toolEvents: response.tool_events,
          model: response.model,
        },
      ]);
      if (response.tool_events.length) await refreshProductData();
    } catch (err) {
      if (requestId === controller.current) setError(engineErrorMessage(err));
    } finally {
      setBusy(false);
      setZevState("idle");
    }
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(input);
  };
  return (
    <ProductFrame padded={false} inspector={false}>
      <div className="nova-chat">
        <header className="nova-chat-header">
          <div>
            <MessageCircle size={18} className="text-accent-text" />
            <b>Zev</b>
            <small>
              <span className="nova-live-dot" /> AI helpdesk
            </small>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setLines([]);
              setError("");
            }}
          >
            <Plus size={13} /> New conversation
          </button>
        </header>
        <div className="nova-chat-scroll" ref={scrollRef}>
          <div className="nova-chat-inner">
            {!lines.length && (
              <section className="nova-chat-welcome">
                <div className="nova-chat-spark">
                  <Sparkles size={29} strokeWidth={1.3} />
                </div>
                <span>YOUR SPACE TO MAKE THINGS LIGHTER</span>
                <h1>
                  Welcome back, <em>{name}.</em>
                </h1>
                <p>
                  A fresh perspective. A little guidance.
                  <br />
                  What can I help you with today?
                </p>
                <div className="nova-chat-suggestions">
                  {suggestions.map(({ title, description, prompt, Icon }) => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => void submit(prompt)}
                      disabled={busy}
                    >
                      <Icon size={19} />
                      <b>{title}</b>
                      <small>{description}</small>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className="grid gap-6" aria-live="polite" aria-busy={busy}>
              {lines.map((line) => (
                <article
                  key={line.id}
                  className={`pmsg ${line.role === "user" ? "is-user" : "is-zev"}`}
                >
                  {line.role === "assistant" && (
                    <div className="nova-icon-box shrink-0 !h-8 !w-8 !rounded-xl">
                      <Sparkles size={14} />
                    </div>
                  )}
                  <div className="min-w-0 max-w-[88%]">
                    <div className="pmsg-bubble whitespace-pre-wrap">
                      {line.content}
                    </div>
                    {!!line.toolEvents?.length && (
                      <div className="mt-2 grid gap-1">
                        {line.toolEvents.map((event, i) => (
                          <div key={i} className="ptool-event">
                            <ShieldCheck size={11} />
                            <span>{event.summary}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {line.role === "assistant" && (
                      <button
                        type="button"
                        aria-label="Copy answer"
                        className="mt-2 text-subtle"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(line.content)
                            .then(() => {
                              setCopied(line.id);
                              window.setTimeout(() => setCopied(""), 1800);
                            })
                            .catch(() =>
                              setError(
                                "Copy is unavailable in this browser. Select the answer to copy it.",
                              ),
                            );
                        }}
                      >
                        {copied === line.id ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {busy && (
                <div className="flex items-center gap-3 text-xs text-subtle">
                  <Sparkles size={16} />
                  <span className="pthinking">
                    <i />
                    <i />
                    <i />
                  </span>{" "}
                  Zev is thinking
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="nova-chat-composer">
          {error && (
            <div role="alert" className="pnote pnote-error">
              {error}
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => {
                  const last = lines.at(-1);
                  if (last?.role === "user") {
                    setLines((current) => current.slice(0, -1));
                    setInput(last.content);
                    setError("");
                  }
                }}
              >
                Edit and retry
              </button>
            </div>
          )}
          <form onSubmit={onSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void submit(input);
                }
              }}
              rows={2}
              maxLength={8000}
              aria-label="Message Zev"
              placeholder="Ask Zev anything about ZEVQORA…"
            />
            <div>
              <span>
                <Sparkles size={12} /> Zev helpdesk{" "}
                {selected ? `· ${selected.name}` : ""}
              </span>
              <button
                type="submit"
                disabled={!input.trim() || busy}
                aria-label="Send message"
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </form>
          <p>
            <ShieldCheck size={10} className="inline mr-1" />
            Zev can make mistakes. You stay in control of your workspace.
          </p>
        </div>
      </div>
    </ProductFrame>
  );
}

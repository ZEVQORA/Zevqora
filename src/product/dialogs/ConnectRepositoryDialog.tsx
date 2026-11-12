import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Github, Radio, ShieldCheck } from "lucide-react";
import { useProduct } from "../store";
import { engineErrorMessage } from "../engine";
import { Button, Field, Modal, Note } from "../ui";

export function ConnectRepositoryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { connectRepository } = useProduct();
  const navigate = useNavigate();
  const [source, setSource] = useState<"github" | "server">("github");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await connectRepository({
        source,
        path: url.trim(),
        name: name.trim() || undefined,
      });
      if (result) {
        setUrl("");
        setName("");
        onClose();
        navigate(source === "server" ? "/app/connections" : "/app/project");
      }
    } catch (err) {
      setError(engineErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="lg"
      eyebrow="YOUR STACK, CONNECTED"
      title="Bring your project."
      description="Connect a GitHub repository or start a server workload. Your workspace keeps everything in one place."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={source === "github" ? !url.trim() : !name.trim()}
          >
            {busy
              ? "Connecting…"
              : source === "github"
                ? "Connect repository"
                : "Create server workload"}{" "}
            {!busy && <ArrowRight size={14} />}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              {
                key: "github",
                Icon: Github,
                label: "GitHub repository",
                detail: "Scan source from your repository",
              },
              {
                key: "server",
                Icon: Radio,
                label: "Server / runtime",
                detail: "Connect execution evidence",
              },
            ] as const
          ).map(({ key, Icon, label, detail }) => (
            <button
              key={key}
              type="button"
              disabled={busy}
              aria-pressed={source === key}
              onClick={() => {
                setSource(key);
                setError("");
              }}
              className={`rounded-xl border p-4 text-left transition-colors ${source === key ? "border-accent bg-accent-subtle" : "border-line bg-surface"}`}
            >
              <Icon size={21} className="mb-3 text-accent-text" />
              <b className="block text-[12px] text-ink">{label}</b>
              <span className="mt-1 block text-[10px] text-subtle">
                {detail}
              </span>
            </button>
          ))}
        </div>
        {source === "github" && (
          <Field label="GitHub repository URL">
            <input
              className="pinput"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/your-team/your-project"
              autoComplete="url"
              disabled={busy}
            />
          </Field>
        )}
        <Field
          label={
            source === "server" ? "Workload name" : "Project name (optional)"
          }
        >
          <input
            className="pinput"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              source === "server"
                ? "e.g. Production support assistant"
                : "Defaults to your repository name"
            }
            maxLength={80}
            disabled={busy}
          />
        </Field>
        <Note tone="info">
          {source === "github"
            ? "Public repositories work directly. Private repositories require a GitHub sign-in with access to the repository. Scans are limited to 250 supported source files and 4 MB."
            : "Create the workload, then connect server telemetry from Connections or import a sanitized trace export. Zev can walk you through the setup."}
        </Note>
        <div className="flex items-start gap-3 text-[11px] leading-relaxed text-subtle">
          <ShieldCheck size={16} className="shrink-0 text-accent-text" />
          <span>
            {source === "github"
              ? "Read-only scanning. Source is processed on the server; only call sites and findings are retained. Sensitive paths are skipped. No repository code is executed."
              : "Your server stays under your control. Only explicitly configured telemetry is sent to your workspace."}
          </span>
        </div>
        {error && <Note tone="error">{error}</Note>}
      </div>
    </Modal>
  );
}

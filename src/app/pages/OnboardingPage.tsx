import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { AuthShell } from "@/auth/AuthShell";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/lib/api";
import { app } from "../data";

export default function OnboardingPage() {
  const { me, refreshMe, setActiveWorkspaceId } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    document.title = "Your workspace — ZEVQORA";
  }, []);
  if (me?.workspaces.length && !createdId)
    return <Navigate to="/app/zev" replace />;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const id =
        createdId || (await app.createWorkspace(name.trim())).workspace.id;
      setCreatedId(id);
      setActiveWorkspaceId(id);
      const refreshed = await refreshMe();
      if (!refreshed?.workspaces.some((workspace) => workspace.id === id))
        throw new Error(
          "Your workspace was created. Retry to finish loading it.",
        );
      await app
        .updateMe({
          onboarding: {
            completed_at: new Date().toISOString(),
            plan_interest: params.get("plan") || null,
          },
        })
        .catch(() => undefined);
      navigate("/app/zev", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };
  return (
    <AuthShell
      title="Make yourself at home"
      subtitle="Give your workspace a name. Zev will take it from here."
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-5">
        <Field
          id="workspace-name"
          label="Workspace name"
          hint="Your team, your company, or just you."
        >
          <Input
            id="workspace-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={80}
            placeholder="My workspace"
            required
            disabled={pending || Boolean(createdId)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-xs text-rejected">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          loading={pending}
          disabled={pending || (!createdId && name.trim().length < 2)}
        >
          Enter your workspace <ArrowRight size={16} />
        </Button>
        <p className="flex items-center justify-center gap-2 text-[11px] text-subtle">
          <Sparkles size={13} />
          Connect projects whenever you’re ready.
        </p>
      </form>
    </AuthShell>
  );
}

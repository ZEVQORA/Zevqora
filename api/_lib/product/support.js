export const SUPPORT_GUIDE = `ZEVQORA helps teams understand AI execution costs and verify candidate optimizations before human review.
Create an account at /signup with your name, email, and password. Confirm the email if requested. Sessions are remembered automatically. Reset your password at /forgot-password.
After signing in, create a workspace and chat with Zev at /app/zev. Connect a GitHub repository or create a server workload using Connect a repository. Public GitHub repositories can be read directly; private repositories require a GitHub session with access. GitHub scans are read-only, limited to 250 source files / 4 MB. No repository code is executed. Source is processed on the server; call sites and findings are stored.
Server evidence can be imported as JSON/JSONL from /app/connections. OpenTelemetry and OpenInference setup is documented at /app/docs. Live telemetry setup depends on workspace feature availability; do not claim it is connected without evidence.
Manage account settings at /app/settings, teammates at /app/team and plan/usage at /app/usage. Published plan information is at /pricing. Never invent a price, account balance, discount, or account status.
Only a verification whose deterministic evaluation gates passed is VERIFIED. Static scan findings are potential opportunities, not proven savings. A human reviews changes before shipping.
For account-specific issues contact zevqora.ai@gmail.com. Never ask for passwords, API keys, or private traces in public support.`;

export function supportFallback(message) {
  const value = message.toLowerCase();
  if (/github|repo|repository|connect|холбо/.test(value))
    return "Open your workspace and choose “Connect a repository”. Paste a GitHub URL to scan supported source files, or choose “Server / runtime” to create a workload. Public repositories work directly; private repositories require a GitHub sign-in with access. Setup instructions are in /app/docs.";
  if (/password|reset|forgot|нууц/.test(value))
    return "Use /forgot-password to request a password reset link. Open the email on the same device and set your new password. Never share your password in chat. If the email does not arrive, check spam or contact zevqora.ai@gmail.com.";
  if (/sign|login|account|register|бүртг|нэвт/.test(value))
    return "Create your account at /signup using your name, email, and a password of at least 10 characters. Confirm your email if asked, then name your workspace. You will stay signed in on this device until you sign out or your session is revoked.";
  if (/price|bill|plan|credit|үнэ|төлбөр/.test(value))
    return "Published plans are at /pricing. Your workspace’s actual plan and credit usage are in /app/usage. For billing questions that need a person, contact zevqora.ai@gmail.com.";
  if (/verify|cost|optim|quality|хэмн/.test(value))
    return "Connect a repository and import representative execution traces. ZEVQORA identifies potential opportunities, then compares candidate behavior with a baseline using evaluation gates. Only passing evidence can be marked verified. You decide what ships.";
  return "I can help you get started, connect GitHub or server evidence, find workspace settings, and understand verification. Open /app/zev for your workspace AI assistant, or contact zevqora.ai@gmail.com for account-specific help.";
}

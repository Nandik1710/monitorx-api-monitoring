import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  RiPulseLine,
  RiArrowRightLine,
  RiShieldCheckLine,
  RiGithubLine,
} from "@remixicon/react";
import { authResponseSchema } from "@monitorx/contracts";
import { Button, Field, Notice } from "@monitorx/ui";
import { workspaceRequest as api } from "./workspace-api.js";
import { useSession } from "./session.js";
import { AppLink, ThemeToggle } from "./navigation.js";
const labels = {
  login: "Sign in",
  register: "Create account",
  "forgot-password": "Reset your password",
  "resend-verification": "Resend verification",
  "verify-email": "Verify your email",
  "reset-password": "Set a new password",
} as const;
export function AuthPanel() {
  const params = useParams(),
    navigate = useNavigate(),
    location = useLocation(),
    session = useSession();
  const mode = Object.hasOwn(labels, params["mode"] ?? "")
    ? (params["mode"] as keyof typeof labels)
    : "login";
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false),
    [github, setGithub] = useState(false);
  useEffect(() => {
    let active = true;
    void api("/auth/config")
      .then((raw) => {
        if (
          active &&
          typeof raw === "object" &&
          raw !== null &&
          "githubEnabled" in raw
        )
          setGithub(raw.githubEnabled === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setMessage("");
    setError(false);
  }, [mode]);
  function destination() {
    const value: unknown = location.state;
    if (
      value &&
      typeof value === "object" &&
      "from" in value &&
      typeof value.from === "string" &&
      value.from.startsWith("/app/")
    )
      return value.from;
    return "/app/workspaces";
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError(false);
    const form = event.currentTarget;
    try {
      const body = Object.fromEntries(new FormData(form)) as Record<
        string,
        string
      >;
      if (mode === "verify-email" || mode === "reset-password") {
        if (session.link?.kind !== mode)
          throw Error(
            "Open the verification or reset link from your email first.",
          );
        body["token"] = session.link.token;
      }
      const response = await api(`/auth/${mode}`, "POST", body);
      form.reset();
      if (mode === "login") {
        session.setUser(authResponseSchema.parse(response).user);
        navigate(destination(), { replace: true });
      } else {
        setMessage(
          mode === "register" || mode === "resend-verification"
            ? "Check your email for the next step. In local development, use the Mailpit inbox."
            : mode === "forgot-password"
              ? "If the account exists, a reset email has been sent."
              : "Done. You can now sign in.",
        );
        if (mode === "verify-email" || mode === "reset-password")
          session.clearLink();
      }
    } catch (cause) {
      setError(true);
      setMessage(
        cause instanceof Error ? cause.message : "Unable to continue.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <AppLink href="/" className="brand">
          <span className="brand-mark">
            <RiPulseLine />
          </span>
          monitor<span className="brand-x">x</span>
          <span className="brand-divider">/</span>
        </AppLink>
        <div className="auth-story-copy">
          <p className="eyebrow">Observe. Understand. Improve.</p>
          <h1>
            Confidence in
            <br />
            every request<span className="accent-dot">.</span>
          </h1>
          <p className="editorial">
            A calmer place to test your APIs, follow every execution, and
            understand what changed.
          </p>
          <div className="terminal-preview" aria-label="Product capabilities">
            <div>
              <span className="terminal-dot" />
              <span className="terminal-dot" />
              <span className="terminal-dot" />
              <span>monitorx / workspace</span>
            </div>
            <p>
              <span className="syntax-comment">
                // Built for the details that matter
              </span>
              <br />
              <span className="syntax-key">request</span> → assertions → results
              <br />
              <span className="syntax-key">schedule</span> → worker → history
              <br />
              <span className="syntax-key">secrets</span> → encrypted & masked
            </p>
          </div>
        </div>
        <p className="auth-footnote">
          <RiShieldCheckLine size={17} /> Tenant-isolated. Worker-powered.
        </p>
      </aside>
      <main className="auth-main">
        <div className="auth-top">
          <span>YOUR RELIABILITY WORKSPACE</span>
          <ThemeToggle />
        </div>
        <section className="auth-form-card" aria-labelledby="auth-title">
          <p className="eyebrow">
            {mode === "register" ? "Get started" : "Welcome to Monitor-X"}
          </p>
          <h2 id="auth-title">{labels[mode]}</h2>
          <p className="muted">
            {mode === "login"
              ? "Pick up where your last check left off."
              : "Keep your account secure. We’ll guide you through it."}
          </p>
          {message && <Notice error={error}>{message}</Notice>}
          <form key={mode} onSubmit={submit}>
            <fieldset disabled={busy}>
              {mode === "register" && (
                <Field label="Name">
                  <input
                    name="displayName"
                    required
                    maxLength={120}
                    autoComplete="name"
                    placeholder="Your name"
                  />
                </Field>
              )}
              {mode !== "verify-email" && mode !== "reset-password" && (
                <Field label="Email">
                  <input
                    name="email"
                    type="email"
                    required
                    maxLength={320}
                    autoComplete="email"
                    placeholder="you@company.com"
                  />
                </Field>
              )}
              {["login", "register", "reset-password"].includes(mode) && (
                <Field label="Password">
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={mode === "login" ? 1 : 12}
                    maxLength={128}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                  />
                </Field>
              )}
              {mode === "register" && (
                <p className="field-hint">
                  12–128 characters. Email verification is required.
                </p>
              )}
              {mode === "verify-email" && (
                <p>
                  Confirm below to verify the email associated with this link.
                </p>
              )}
              <Button type="submit" variant="primary" className="auth-submit">
                {busy ? "Please wait…" : labels[mode]}
                <RiArrowRightLine size={18} />
              </Button>
            </fieldset>
          </form>
          {mode === "login" && (
            <AppLink href="/auth/forgot-password" className="auth-forgot">
              Forgot your password?
            </AppLink>
          )}
          {github && (
            <a
              className="ui-button github-signin"
              href={`${String(import.meta.env["VITE_API_BASE_URL"] ?? "http://localhost:4000")}/api/v1/auth/github`}
            >
              <RiGithubLine size={18} />
              Continue with GitHub
            </a>
          )}
          <nav className="auth-links" aria-label="Account actions">
            <AppLink href={mode === "login" ? "/auth/register" : "/auth/login"}>
              {mode === "login"
                ? "New here? Create an account"
                : "Back to sign in"}
            </AppLink>
            <AppLink href="/auth/resend-verification">
              Resend verification
            </AppLink>
          </nav>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api("/auth/refresh", "POST", {})
                .then((raw) => {
                  session.setUser(authResponseSchema.parse(raw).user);
                  navigate(destination(), { replace: true });
                })
                .catch(() => {
                  setError(true);
                  setMessage("No active session. Please sign in.");
                })
                .finally(() => setBusy(false));
            }}
          >
            Restore existing session
          </Button>
        </section>
        <p className="auth-footer">
          Monitor-X · API testing & reliability monitoring
        </p>
      </main>
    </div>
  );
}

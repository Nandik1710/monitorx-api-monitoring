import { useState, type ReactNode } from "react";
import { z } from "zod";
import { Button, Field, Notice } from "@monitorx/ui";
import { RiArrowRightLine, RiInbox2Line } from "@remixicon/react";
import { AppLink } from "../navigation.js";
export function PageHeader({
  eyebrow = "WORKSPACE",
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action && <div className="page-header-actions">{action}</div>}
    </header>
  );
}
export function EmptyState({
  title,
  children,
  href,
  action,
}: {
  title: string;
  children: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <RiInbox2Line size={28} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {href && (
        <AppLink href={href} className="ui-button button-primary">
          {action ?? "Continue"}
          <RiArrowRightLine size={16} />
        </AppLink>
      )}
    </div>
  );
}
export function Loading({
  error,
  reload,
}: {
  error?: string;
  reload?: () => void;
}) {
  return error ? (
    <Notice error>
      {error}
      {reload && <Button onClick={reload}>Try again</Button>}
    </Notice>
  ) : (
    <div className="loading-state" role="status">
      <span className="loader" />
      Loading your workspace…
    </div>
  );
}
export function NameFields() {
  return (
    <div className="form-grid">
      <Field label="Name">
        <input
          name="name"
          required
          maxLength={120}
          placeholder="A clear, memorable name"
        />
      </Field>
      <Field label="Slug" hint="Lowercase letters, numbers and hyphens.">
        <input
          name="slug"
          required
          minLength={2}
          maxLength={120}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="my-project"
        />
      </Field>
    </div>
  );
}
export const formValue = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) ?? "");
export function useAction() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  return {
    busy,
    notice: message ? <Notice error={failed}>{message}</Notice> : null,
    run: async (
      work: () => Promise<void | false>,
      success = "Saved successfully.",
    ) => {
      setBusy(true);
      setMessage("");
      setFailed(false);
      try {
        if ((await work()) !== false) setMessage(success);
      } catch (cause) {
        setFailed(true);
        setMessage(
          cause instanceof z.ZodError || cause instanceof SyntaxError
            ? "Check the form values and try again."
            : cause instanceof Error
              ? cause.message
              : "The action could not be completed.",
        );
      } finally {
        setBusy(false);
      }
    },
  };
}

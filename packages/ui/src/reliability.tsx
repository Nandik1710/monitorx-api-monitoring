import { useState, type ReactElement } from "react";
export function StatusLabel({ value }: { value: string }): ReactElement {
  const symbol =
    value === "HEALTHY" || value === "PASSED"
      ? "✓"
      : value === "DOWN" || value === "FAILED"
        ? "✕"
        : value === "DEGRADED"
          ? "!"
          : value === "PAUSED"
            ? "Ⅱ"
            : "?";
  return (
    <span className={`status-label status-${value.toLowerCase()}`}>
      <span aria-hidden="true">{symbol} </span>
      {value}
    </span>
  );
}
export function CodeViewer({
  label,
  value,
}: {
  label: string;
  value: unknown;
}): ReactElement {
  const [message, setMessage] = useState("");
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value, null, 2) ?? "No data");
  return (
    <section className="code-viewer" aria-label={label}>
      <h4>{label}</h4>
      <button
        type="button"
        onClick={() => {
          if (!navigator.clipboard) {
            setMessage("Copy unavailable; select the text below.");
            return;
          }
          void navigator.clipboard.writeText(text).then(
            () => setMessage("Copied."),
            () => setMessage("Copy unavailable; select the text below."),
          );
        }}
      >
        Copy {label}
      </button>
      <span role="status">{message}</span>
      <pre tabIndex={0}>
        <code>{text}</code>
      </pre>
    </section>
  );
}

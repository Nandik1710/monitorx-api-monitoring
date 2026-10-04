import type { ReactElement } from "react";
import type { KeyValueRow } from "@monitorx/contracts";
import { Button, Field } from "@monitorx/ui";

export function RowsEditor({
  label,
  rows,
  onChange,
  readOnly,
}: {
  label: string;
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  readOnly: boolean;
}): ReactElement {
  const update = (index: number, change: Partial<KeyValueRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  return (
    <section aria-label={label}>
      <h4>{label}</h4>
      {rows.map((row, index) => (
        <div className="builder-row" key={index}>
          <Field label={`${label} ${index + 1} key`}>
            <input
              value={row.key}
              maxLength={200}
              readOnly={readOnly}
              onChange={(e) => update(index, { key: e.target.value })}
            />
          </Field>
          <Field label={`${label} ${index + 1} value`}>
            <input
              value={row.value}
              maxLength={10000}
              readOnly={readOnly}
              placeholder="Value or {{VARIABLE}}"
              onChange={(e) => update(index, { value: e.target.value })}
            />
          </Field>
          <label>
            <input
              type="checkbox"
              checked={row.enabled}
              disabled={readOnly}
              onChange={(e) => update(index, { enabled: e.target.checked })}
            />
            Enabled {label} {index + 1}
          </label>
          <label>
            <input
              type="checkbox"
              checked={row.sensitive}
              disabled={readOnly}
              onChange={(e) => update(index, { sensitive: e.target.checked })}
            />
            Sensitive {label} {index + 1}
          </label>
          {!readOnly && (
            <Button
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              Remove {label} {index + 1}
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button
          disabled={rows.length >= 100}
          onClick={() =>
            onChange([
              ...rows,
              { key: "", value: "", enabled: true, sensitive: false },
            ])
          }
        >
          Add {label}
        </Button>
      )}
    </section>
  );
}

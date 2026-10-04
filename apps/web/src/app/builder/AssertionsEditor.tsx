import type { ReactElement } from "react";
import { type Assertion } from "@monitorx/contracts";
import { Button, Field } from "@monitorx/ui";

export function defaultAssertion(type: Assertion["type"]): Assertion {
  const severity = "REQUIRED" as const;
  switch (type) {
    case "status":
      return { type, severity, expected: 200 };
    case "latency":
      return { type, severity, expected: 500 };
    case "header":
      return {
        type,
        severity,
        name: "content-type",
        operator: "contains",
        expected: "application/json",
      };
    case "json_path":
      return { type, severity, path: "$.id" };
    case "json_compare":
      return {
        type,
        severity,
        path: "$.success",
        operator: "equals",
        expected: true,
      };
    case "text":
      return { type, severity, operator: "contains", expected: "healthy" };
    case "regex":
      return { type, severity, pattern: "healthy", flags: "" };
    case "xpath":
      return { type, severity, path: "/Envelope/Body/Status", expected: "OK" };
  }
}
export function AssertionsEditor({
  assertions,
  onChange,
  readOnly,
}: {
  assertions: Assertion[];
  onChange: (value: Assertion[]) => void;
  readOnly: boolean;
}): ReactElement {
  const update = (index: number, change: object) =>
    onChange(
      assertions.map((item, i) =>
        i === index ? ({ ...item, ...change } as Assertion) : item,
      ),
    );
  return (
    <section>
      <p>
        Required failures fail a check; warnings can mark it degraded.
        Assertions are evaluated by the worker when a saved test runs.
      </p>
      {assertions.map((item, index) => (
        <fieldset key={index} disabled={readOnly} className="assertion-card">
          <legend>Assertion {index + 1}</legend>
          <Field label={`Assertion ${index + 1} type`}>
            <select
              value={item.type}
              onChange={(e) =>
                onChange(
                  assertions.map((value, i) =>
                    i === index
                      ? defaultAssertion(e.target.value as Assertion["type"])
                      : value,
                  ),
                )
              }
            >
              {[
                "status",
                "latency",
                "header",
                "json_path",
                "json_compare",
                "text",
                "regex",
                "xpath",
              ].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
          <Field label={`Assertion ${index + 1} severity`}>
            <select
              value={item.severity}
              onChange={(e) => update(index, { severity: e.target.value })}
            >
              <option>REQUIRED</option>
              <option>WARNING</option>
            </select>
          </Field>
          {"path" in item && (
            <Field label={`Assertion ${index + 1} path`}>
              <input
                value={item.path}
                maxLength={500}
                onChange={(e) => update(index, { path: e.target.value })}
              />
            </Field>
          )}
          {item.type === "header" && (
            <Field label={`Assertion ${index + 1} header`}>
              <input
                value={item.name}
                onChange={(e) => update(index, { name: e.target.value })}
              />
            </Field>
          )}
          {"operator" in item && (
            <Field label={`Assertion ${index + 1} operator`}>
              <select
                value={item.operator}
                onChange={(e) => update(index, { operator: e.target.value })}
              >
                {(item.type === "json_compare"
                  ? ["equals", "not_equals", "gt", "gte", "lt", "lte"]
                  : item.type === "header"
                    ? ["exists", "equals", "contains"]
                    : ["equals", "contains"]
                ).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
          )}
          {"expected" in item && (
            <Field
              label={`Assertion ${index + 1} expected`}
              hint={
                item.type === "status"
                  ? "One status or comma-separated statuses."
                  : item.type === "json_compare"
                    ? "JSON scalar: true, 42, null or a quoted string."
                    : undefined
              }
            >
              <input
                key={`${item.type}-${JSON.stringify(item.expected)}`}
                defaultValue={
                  item.type === "status" && Array.isArray(item.expected)
                    ? item.expected.join(",")
                    : item.type === "json_compare"
                      ? JSON.stringify(item.expected)
                      : String(item.expected)
                }
                onBlur={(e) => {
                  const value = e.target.value;
                  if (item.type === "status")
                    update(index, {
                      expected: value.includes(",")
                        ? value.split(",").map(Number)
                        : Number(value),
                    });
                  else if (item.type === "latency")
                    update(index, { expected: Number(value) });
                  else if (item.type === "json_compare") {
                    try {
                      update(index, { expected: JSON.parse(value) as unknown });
                    } catch {
                      update(index, { expected: value });
                    }
                  } else update(index, { expected: value });
                }}
              />
            </Field>
          )}
          {item.type === "regex" && (
            <>
              <Field label={`Assertion ${index + 1} pattern`}>
                <input
                  value={item.pattern}
                  maxLength={500}
                  onChange={(e) => update(index, { pattern: e.target.value })}
                />
              </Field>
              <Field label={`Assertion ${index + 1} flags`}>
                <select
                  value={item.flags}
                  onChange={(e) => update(index, { flags: e.target.value })}
                >
                  {["", "i", "m", "im"].map((flag) => (
                    <option key={flag} value={flag}>
                      {flag || "None"}
                    </option>
                  ))}
                </select>
              </Field>
              <p>
                Patterns are stored only; no regular expression runs in the API
                or this form.
              </p>
            </>
          )}
          {!readOnly && (
            <Button
              onClick={() => onChange(assertions.filter((_, i) => i !== index))}
            >
              Remove assertion {index + 1}
            </Button>
          )}
        </fieldset>
      ))}
      {!readOnly && (
        <Button
          disabled={assertions.length >= 100}
          onClick={() => onChange([...assertions, defaultAssertion("status")])}
        >
          Add assertion
        </Button>
      )}
    </section>
  );
}

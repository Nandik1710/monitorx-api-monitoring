import { useEffect, useState, type ReactElement } from "react";
import { z } from "zod";
import {
  monitorScheduleSchema,
  type MonitorSchedule,
} from "@monitorx/contracts";
import { Button, Field, Notice } from "@monitorx/ui";
import { workspaceRequest as api } from "../workspace-api.js";
const savedSchema = z
  .object({
    id: z.string().uuid(),
    nextRunAt: z.string().nullable(),
    pausedAt: z.string().nullable(),
  })
  .passthrough();
export function SchedulePanel({
  testId,
  organizationId,
  environments,
  readOnly,
}: {
  testId: string;
  organizationId: string;
  environments: { id: string; name: string }[];
  readOnly: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<MonitorSchedule>(() =>
    monitorScheduleSchema.parse({
      testId,
      environmentId: environments[0]?.id ?? testId,
    }),
  );
  const [id, setId] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [windows, setWindows] = useState("[]");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void api(`/tests/${testId}/schedule`, "GET", undefined, organizationId)
      .then((raw) => {
        if (!active || raw === null) return;
        const saved = savedSchema.parse(raw);
        const fields = Object.fromEntries(
          Object.keys(monitorScheduleSchema.shape).map((key) => [
            key,
            key === "paused" ? saved.pausedAt !== null : saved[key],
          ]),
        );
        setDraft(monitorScheduleSchema.parse(fields));
        setId(saved.id);
        setNext(saved.nextRunAt);
        setWindows(JSON.stringify(saved["maintenanceWindows"], null, 2));
      })
      .catch(() => {
        if (active) {
          setError(true);
          setMessage("Unable to load schedule.");
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [testId, organizationId]);
  const change = (value: Partial<MonitorSchedule>) =>
    setDraft((old) => ({ ...old, ...value }));
  const save = async (paused?: boolean) => {
    setBusy(true);
    setError(false);
    setMessage("");
    try {
      const value = monitorScheduleSchema.parse({
        ...draft,
        ...(paused === undefined ? {} : { paused }),
        maintenanceWindows: JSON.parse(windows) as unknown,
      });
      const { testId: ignored, ...update } = value;
      void ignored;
      const saved = savedSchema.parse(
        await api(
          id ? `/schedules/${id}` : "/schedules",
          id ? "PATCH" : "POST",
          id ? update : value,
          organizationId,
        ),
      );
      setId(saved.id);
      setNext(saved.nextRunAt);
      setDraft(value);
      setMessage(
        "Schedule saved. Enabling sends recurring requests from workers.",
      );
    } catch {
      setError(true);
      setMessage(
        "Could not save. Check the environment, time zone, maintenance JSON and that the test is enabled and saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Monitoring schedule">
      <h4>Monitoring schedule</h4>
      <p>
        Next slot: {next ? new Date(next).toLocaleString() : "Not scheduled"}.
        Save and enable the test before enabling recurring monitoring.
      </p>
      {message && <Notice error={error}>{message}</Notice>}
      <fieldset disabled={busy || readOnly}>
        <Field label="Schedule environment">
          <select
            value={draft.environmentId}
            onChange={(e) => change({ environmentId: e.target.value })}
          >
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cadence">
          <select
            value={draft.cadence}
            onChange={(e) =>
              change({ cadence: e.target.value as MonitorSchedule["cadence"] })
            }
          >
            {["INTERVAL", "HOURLY", "DAILY"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        {draft.cadence === "INTERVAL" ? (
          <Field label="Interval minutes">
            <select
              value={draft.intervalMinutes}
              onChange={(e) =>
                change({
                  intervalMinutes: Number(
                    e.target.value,
                  ) as MonitorSchedule["intervalMinutes"],
                })
              }
            >
              {[1, 5, 10, 15, 30, 60].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            {draft.cadence === "DAILY" && (
              <Field label="Hour (0-23)">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={draft.hour}
                  onChange={(e) => change({ hour: Number(e.target.value) })}
                />
              </Field>
            )}
            <Field label="Minute (0-59)">
              <input
                type="number"
                min={0}
                max={59}
                value={draft.minute}
                onChange={(e) => change({ minute: Number(e.target.value) })}
              />
            </Field>
          </>
        )}
        <Field label="Time zone">
          <input
            value={draft.timeZone}
            onChange={(e) => change({ timeZone: e.target.value })}
            placeholder="Asia/Kolkata"
          />
        </Field>
        <label>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => change({ enabled: e.target.checked })}
          />
          Schedule enabled
        </label>
        <Field label="Failures to open incident">
          <input
            type="number"
            min={1}
            max={20}
            value={draft.failureThreshold}
            onChange={(e) =>
              change({ failureThreshold: Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Successes to recover">
          <input
            type="number"
            min={1}
            max={20}
            value={draft.recoveryThreshold}
            onChange={(e) =>
              change({ recoveryThreshold: Number(e.target.value) })
            }
          />
        </Field>
        <p>
          Thresholds are saved for the incident phase; they do not send alerts
          yet.
        </p>
        <Field
          label="Maintenance windows (UTC JSON)"
          hint={
            'Example: [{"start":"2026-12-01T00:00:00Z","end":"2026-12-01T01:00:00Z"}]'
          }
        >
          <textarea
            value={windows}
            onChange={(e) => setWindows(e.target.value)}
            rows={4}
            maxLength={5000}
          />
        </Field>
        {!readOnly && (
          <>
            <Button onClick={() => void save()}>Save schedule</Button>
            {id && (
              <Button onClick={() => void save(!draft.paused)}>
                {draft.paused ? "Resume schedule" : "Pause schedule"}
              </Button>
            )}
          </>
        )}
      </fieldset>
    </section>
  );
}

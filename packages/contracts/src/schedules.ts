import { z } from "zod";
export const maintenanceWindowSchema = z
  .object({ start: z.string().datetime(), end: z.string().datetime() })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.end) > Date.parse(v.start) &&
      Date.parse(v.end) - Date.parse(v.start) <= 366 * 86400000,
    "Maintenance end must follow start within one year.",
  );
export const monitorScheduleSchema = z
  .object({
    testId: z.string().uuid(),
    environmentId: z.string().uuid(),
    cadence: z.enum(["INTERVAL", "HOURLY", "DAILY"]).default("INTERVAL"),
    intervalMinutes: z
      .union([
        z.literal(1),
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(30),
        z.literal(60),
      ])
      .default(5),
    hour: z.number().int().min(0).max(23).default(0),
    minute: z.number().int().min(0).max(59).default(0),
    timeZone: z
      .string()
      .min(1)
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Use a valid IANA time zone.")
      .default("UTC"),
    enabled: z.boolean().default(false),
    paused: z.boolean().default(false),
    maintenanceWindows: z.array(maintenanceWindowSchema).max(20).default([]),
    failureThreshold: z.number().int().min(1).max(20).default(2),
    recoveryThreshold: z.number().int().min(1).max(20).default(2),
  })
  .strict();
export const monitorScheduleUpdateSchema = monitorScheduleSchema
  .omit({ testId: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export type MonitorSchedule = z.infer<typeof monitorScheduleSchema>;
export function inMaintenance(windows: unknown, now: Date): boolean {
  const parsed = z.array(maintenanceWindowSchema).safeParse(windows);
  if (!parsed.success) return true; // Invalid persisted maintenance config fails closed.
  return parsed.data.some(
    (window) =>
      Date.parse(window.start) <= now.getTime() &&
      now.getTime() < Date.parse(window.end),
  );
}

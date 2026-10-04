import { describe, it, expect } from "vitest";
import {
  monitorScheduleSchema,
  inMaintenance,
} from "../../packages/contracts/src/schedules.js";
import { nextScheduleTime } from "../../packages/db/src/services/schedule-service.js";
const input = (fields = {}) =>
  monitorScheduleSchema.parse({
    testId: "00000000-0000-4000-8000-000000000001",
    environmentId: "00000000-0000-4000-8000-000000000002",
    ...fields,
  });
describe("schedule cadence and maintenance", () => {
  it.each([1, 5, 10, 15, 30, 60])(
    "supports %i minute intervals",
    (intervalMinutes) => {
      expect(
        nextScheduleTime(input({ intervalMinutes }), new Date(0)).getTime(),
      ).toBe(intervalMinutes * 60000);
    },
  );
  it("uses timezone-aware daily cadence across spring and autumn DST", () => {
    const daily = input({
      cadence: "DAILY",
      hour: 9,
      timeZone: "America/New_York",
    });
    expect(
      nextScheduleTime(daily, new Date("2026-03-07T14:00:00Z")).toISOString(),
    ).toBe("2026-03-08T13:00:00.000Z");
    expect(
      nextScheduleTime(daily, new Date("2026-10-31T13:00:00Z")).toISOString(),
    ).toBe("2026-11-01T14:00:00.000Z");
  });
  it("supports hourly minute offsets and rejects invalid zones/cadences", () => {
    expect(
      nextScheduleTime(
        input({ cadence: "HOURLY", minute: 15 }),
        new Date("2026-01-01T00:20:00Z"),
      ).toISOString(),
    ).toBe("2026-01-01T01:15:00.000Z");
    expect(() => input({ timeZone: "Not/AZone" })).toThrow();
    expect(() => input({ intervalMinutes: 2 })).toThrow();
  });
  it("treats maintenance as half-open and invalid persisted windows as paused", () => {
    const windows = [
      { start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z" },
    ];
    expect(inMaintenance(windows, new Date(windows[0]!.start))).toBe(true);
    expect(inMaintenance(windows, new Date(windows[0]!.end))).toBe(false);
    expect(inMaintenance("malformed", new Date())).toBe(true);
    expect(() =>
      input({
        maintenanceWindows: [
          { start: windows[0]!.end, end: windows[0]!.start },
        ],
      }),
    ).toThrow();
  });
});

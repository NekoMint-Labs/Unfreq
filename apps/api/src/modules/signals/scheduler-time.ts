export function isSupportedSchedulerTimeZone(timeZone: string): boolean {
  try { new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(0)); return true; }
  catch { return false; }
}

export function schedulerBusinessTime(now: Date, timeZone: string): { businessDate: string; time: string } {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid scheduler date.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value;
  return { businessDate: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

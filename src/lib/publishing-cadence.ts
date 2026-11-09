export type Cadence = { daily: number; start: string; end: string; zone: string; gap: number };
export const defaultCadence: Cadence = { daily: 3, start: "09:00", end: "21:00", zone: "America/Chicago", gap: 60 };

const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function parseCadence(value: unknown): Cadence | null {
  if (!value || typeof value !== "object") return null;
  const { daily, start, end, zone, gap } = value as Cadence;
  if (!Number.isInteger(daily) || daily < 1 || daily > 20 ||
      !Number.isInteger(gap) || gap < 5 || gap > 720 ||
      typeof start !== "string" || !clock.test(start) || typeof end !== "string" || !clock.test(end) ||
      minute(end) <= minute(start) || (daily - 1) * gap >= minute(end) - minute(start) ||
      typeof zone !== "string" || zone.length > 80) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return { daily, start, end, zone, gap };
  } catch {
    return null;
  }
}

export function planCadence<T extends { id: string; scheduled_at: string | null }>(
  pins: T[], cadence: Cadence, now: number,
) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: cadence.zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const local = (time: number) => formatter.format(time).split(" ");
  const occupied = pins.flatMap(pin => pin.scheduled_at ? [Date.parse(pin.scheduled_at)] : []);
  const counts = new Map<string, number>();
  for (const time of occupied) {
    const [day] = local(time);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const pending = pins.filter(pin => !pin.scheduled_at);
  const result = new Map<string, string>();
  const start = minute(cadence.start);
  const end = minute(cadence.end);
  const spacing = Math.max(cadence.gap, Math.floor((end - start) / cadence.daily));
  const slack = end - start - (cadence.daily - 1) * spacing;
  const step = 60_000;
  for (let time = Math.floor(now / step) * step + step;
       pending.length && time < now + 180 * 1440 * step; time += step) {
    const [day, wallClock] = local(time);
    const used = counts.get(day) ?? 0;
    if (used >= cadence.daily) continue;
    const dayNumber = Date.parse(day + "T00:00:00Z") / 86_400_000;
    const offset = Math.floor(slack * (0.2 + ((dayNumber * 37) % 61) / 100));
    const currentMinute = minute(wallClock);
    if (currentMinute < start + offset + used * spacing || currentMinute >= end) continue;
    if (occupied.some(slot => Math.abs(slot - time) < cadence.gap * step)) continue;
    const pin = pending.shift()!;
    result.set(pin.id, new Date(time).toISOString());
    occupied.push(time);
    counts.set(day, used + 1);
  }
  return result;
}

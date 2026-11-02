// Business dates are plain "YYYY-MM-DD" strings (IST calendar dates).
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const toUtcMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function isValidDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  const ms = toUtcMs(date);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

// Adds calendar months, clamping to the last day of the target month (31 Jan + 1 = 28/29 Feb).
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export const toDbDate = (date: string) => new Date(`${date}T00:00:00Z`);
export const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

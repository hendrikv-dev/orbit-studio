export function toDateTimeLocal(ms: number | string): string {
  const date = typeof ms === 'string' ? new Date(ms) : new Date(ms);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function fromDateTimeLocal(value: string): number {
  return new Date(value).getTime();
}

export function isoFromDateTimeLocal(value: string, fallback: string): string {
  const ms = fromDateTimeLocal(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

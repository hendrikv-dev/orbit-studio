export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatSignedNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const formatted = formatNumber(Math.abs(value), digits);
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

export function parseSimulationTimeUtc(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function normalizeSimulationTimeUtc(value: string | Date, fallback = new Date()): string {
  return parseSimulationTimeUtc(value) ?? fallback.toISOString();
}

export function formatLocalSimulationTime(isoString: string): string {
  const date = new Date(isoString);

  if (!Number.isFinite(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatUtcSimulationTime(isoString: string): string {
  const date = new Date(isoString);

  if (!Number.isFinite(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  })
    .format(date)
    .replace("GMT", "UTC");
}

export function toDateTimeLocalValue(isoString: string): string {
  const date = new Date(isoString);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string): string | null {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

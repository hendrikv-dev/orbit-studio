export const formatNumber = (value: number, digits = 2): string =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : 'Invalid';

export const formatDateTime = (isoTime: string): string => {
  const date = new Date(isoTime);
  if (!Number.isFinite(date.getTime())) {
    return 'Invalid time';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
};

export const toDateTimeLocalValue = (isoTime: string): string => {
  const date = new Date(isoTime);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 19);
};

export const fromDateTimeLocalValue = (value: string): string | null => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds)) {
    return 'Invalid';
  }

  const minutes = seconds / 60;
  if (minutes < 180) {
    return `${formatNumber(minutes, 1)} min`;
  }

  return `${formatNumber(minutes / 60, 2)} hr`;
};

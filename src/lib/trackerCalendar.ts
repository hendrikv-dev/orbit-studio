/**
 * Calendar export: Tracker's free reminder path.
 *
 * V1 §10 sets a strict rule — "any service that costs the developer money is
 * available only to a currently paying user" — and requires at least one
 * reminder path that creates no delivery cost. An `.ics` file built in the
 * browser and handed to the user's own calendar is that path. Nothing is sent
 * anywhere, no account exists, and the reminder is delivered by software the
 * user already owns.
 *
 * Push, email and SMS all cost per message and are therefore not here.
 */

export interface CalendarEvent {
  title: string;
  description: string;
  startUtc: string;
  durationMinutes: number;
  /** Minutes before the start to alert. */
  remindMinutesBefore: number;
}

/** RFC 5545 wants `20260812T230000Z`, with no punctuation. */
function stamp(iso: string): string {
  return `${iso.slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/**
 * Long lines must be folded at 75 octets, and text fields must escape commas,
 * semicolons and newlines. Calendar apps that reject a file do so silently, so
 * this is not optional politeness.
 */
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length > 0) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

export function buildCalendarFile(event: CalendarEvent): string {
  const start = new Date(event.startUtc);
  const end = new Date(start.getTime() + event.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orbit Studio//Tracker//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${stamp(event.startUtc)}-${Math.abs(hash(event.title))}@orbit-studio`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(start.toISOString())}`,
    `DTEND:${stamp(end.toISOString())}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    "BEGIN:VALARM",
    `TRIGGER:-PT${event.remindMinutesBefore}M`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n");
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0;
  }
  return result;
}

/** Hand the file to the browser. Nothing leaves the device. */
export function downloadCalendarFile(event: CalendarEvent): void {
  const blob = new Blob([buildCalendarFile(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

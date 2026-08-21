/**
 * Unit-bearing quantities at Tracker's high-risk astronomy boundaries.
 *
 * These brands deliberately disappear at runtime. Their job is to make a raw
 * number from a dependency impossible to pass as a timestamp, duration, angle,
 * or fraction without naming and validating the conversion first.
 */
type Brand<T, Name extends string> = T & { readonly __unit: Name };

export type Degrees = Brand<number, "degrees">;
export type PhaseCycleDegrees = Brand<number, "phase-cycle-degrees">;
export type AltitudeDegrees = Brand<number, "altitude-degrees">;
export type AzimuthDegrees = Brand<number, "azimuth-degrees">;
export type AngularSeparationDegrees = Brand<number, "angular-separation-degrees">;
export type IlluminationFraction = Brand<number, "illumination-fraction">;
export type Minutes = Brand<number, "minutes">;
export type Milliseconds = Brand<number, "milliseconds">;
export type UtcInstant = Brand<string, "utc-instant">;

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

export const degrees = (value: number): Degrees => finite(value, "degrees") as Degrees;

export function phaseCycleDegrees(value: number): PhaseCycleDegrees {
  const normalized = ((finite(value, "phase cycle") % 360) + 360) % 360;
  return normalized as PhaseCycleDegrees;
}

export function altitudeDegrees(value: number): AltitudeDegrees {
  const checked = finite(value, "altitude");
  if (checked < -90 || checked > 90) throw new RangeError("altitude must be within -90..90°");
  return checked as AltitudeDegrees;
}

export function azimuthDegrees(value: number): AzimuthDegrees {
  return phaseCycleDegrees(value) as unknown as AzimuthDegrees;
}

export function angularSeparationDegrees(value: number): AngularSeparationDegrees {
  const checked = finite(value, "angular separation");
  if (checked < 0 || checked > 180) {
    throw new RangeError("angular separation must be within 0..180°");
  }
  return checked as AngularSeparationDegrees;
}

export function illuminationFraction(value: number): IlluminationFraction {
  const checked = finite(value, "illumination fraction");
  if (checked < 0 || checked > 1) {
    throw new RangeError("illumination fraction must be within 0..1");
  }
  return checked as IlluminationFraction;
}

export function minutes(value: number): Minutes {
  const checked = finite(value, "minutes");
  if (checked < 0) throw new RangeError("minutes must not be negative");
  return checked as Minutes;
}

export function milliseconds(value: number): Milliseconds {
  const checked = finite(value, "milliseconds");
  if (checked < 0) throw new RangeError("milliseconds must not be negative");
  return checked as Milliseconds;
}

export function minutesToMilliseconds(value: Minutes): Milliseconds {
  return milliseconds(Number(value) * 60_000);
}

export function utcInstant(value: Date | string): UtcInstant {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("UTC instant must be a valid date");
  return date.toISOString() as UtcInstant;
}

export function offsetUtc(instant: UtcInstant, offset: Milliseconds): UtcInstant {
  return utcInstant(new Date(Date.parse(instant) + Number(offset)));
}

export function subtractUtc(instant: UtcInstant, duration: Milliseconds): UtcInstant {
  return utcInstant(new Date(Date.parse(instant) - Number(duration)));
}

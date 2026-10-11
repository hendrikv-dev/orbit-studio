/** Unknown extent is not a substitute angular diameter. Sky renders a fixed
 * screen-space object marker regardless of this metadata. */
export function deepSkyAngularRadius(majorAxisArcmin: number | null): number {
  // Unknown extent must exit before any known-object selection allowance.
  if (majorAxisArcmin === null) return 0;
  return Math.max(0.35, majorAxisArcmin / 120);
}

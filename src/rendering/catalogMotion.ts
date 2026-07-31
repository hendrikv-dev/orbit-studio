export function writeInterpolatedThreePositions(
  target: Float32Array,
  targetSatelliteOffset: number,
  startPositions: Float32Array,
  startVelocities: Float32Array,
  endPositions: Float32Array,
  endVelocities: Float32Array,
  valid: Uint8Array,
  startTimestampMs: number,
  endTimestampMs: number,
  targetTimestampMs: number,
  pointScales?: Float32Array,
  basePointScales?: Float32Array,
): number {
  const targetFloatOffset = targetSatelliteOffset * 3;
  const durationSeconds = Math.max(0.001, (endTimestampMs - startTimestampMs) / 1000);
  const interpolation = Math.max(
    0,
    Math.min(1, (targetTimestampMs - startTimestampMs) / (endTimestampMs - startTimestampMs)),
  );
  const t2 = interpolation * interpolation;
  const t3 = t2 * interpolation;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + interpolation;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  let written = 0;

  for (let sourceIndex = 0; sourceIndex < startPositions.length; sourceIndex += 3) {
    const satelliteIndex = sourceIndex / 3;
    const targetIndex = targetFloatOffset + sourceIndex;
    const targetScaleIndex = targetSatelliteOffset + satelliteIndex;
    if (!valid[satelliteIndex]) {
      if (pointScales) pointScales[targetScaleIndex] = 0;
      continue;
    }

    const x =
      h00 * startPositions[sourceIndex] +
      h10 * durationSeconds * startVelocities[sourceIndex] +
      h01 * endPositions[sourceIndex] +
      h11 * durationSeconds * endVelocities[sourceIndex];
    const y =
      h00 * startPositions[sourceIndex + 1] +
      h10 * durationSeconds * startVelocities[sourceIndex + 1] +
      h01 * endPositions[sourceIndex + 1] +
      h11 * durationSeconds * endVelocities[sourceIndex + 1];
    const z =
      h00 * startPositions[sourceIndex + 2] +
      h10 * durationSeconds * startVelocities[sourceIndex + 2] +
      h01 * endPositions[sourceIndex + 2] +
      h11 * durationSeconds * endVelocities[sourceIndex + 2];

    target[targetIndex] = x;
    target[targetIndex + 1] = z;
    target[targetIndex + 2] = -y;
    if (pointScales && basePointScales) {
      pointScales[targetScaleIndex] = basePointScales[targetScaleIndex];
    }
    written += 1;
  }

  return written;
}

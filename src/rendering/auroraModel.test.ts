import { describe, expect, it } from "vitest";
import {
  auroraOvalParametersForKp,
  magneticLatitudeForDirection,
  magneticPoleForHemisphere,
  magneticPoleUnitVector,
  sampleAuroraOvalDirection,
} from "./auroraModel";

describe("aurora model", () => {
  it("anchors auroral ovals to geomagnetic rather than geographic poles", () => {
    const northPole = magneticPoleForHemisphere("north");
    const southPole = magneticPoleForHemisphere("south");

    expect(northPole.latitudeDeg).toBeLessThan(90);
    expect(Math.abs(northPole.longitudeDeg)).toBeGreaterThan(20);
    expect(southPole.latitudeDeg).toBeGreaterThan(-90);
    expect(Math.abs(southPole.longitudeDeg)).toBeGreaterThan(20);
    expect(magneticPoleUnitVector("north")[1]).toBeLessThan(1);
  });

  it("expands the oval equatorward and brightens it as Kp increases", () => {
    const quiet = auroraOvalParametersForKp({ kpIndex: 1, intensity: 1 });
    const disturbed = auroraOvalParametersForKp({ kpIndex: 7, intensity: 1 });

    expect(disturbed.centerMagneticLatitudeDeg).toBeLessThan(
      quiet.centerMagneticLatitudeDeg,
    );
    expect(disturbed.widthDeg).toBeGreaterThan(quiet.widthDeg);
    expect(disturbed.altitudeKm).toBeGreaterThan(quiet.altitudeKm);
    expect(disturbed.curtainTopAltitudeKm).toBeGreaterThan(
      quiet.curtainTopAltitudeKm,
    );
    expect(auroraOvalParametersForKp({ kpIndex: 3 }).curtainTopAltitudeKm).toBeGreaterThan(
      1_000,
    );
    expect(disturbed.intensity).toBeGreaterThan(quiet.intensity);
  });

  it("samples both ovals at the requested magnetic latitude", () => {
    const parameters = auroraOvalParametersForKp({ kpIndex: 3, intensity: 1 });

    (["north", "south"] as const).forEach((hemisphere) => {
      const sample = sampleAuroraOvalDirection(
        hemisphere,
        Math.PI * 0.35,
        parameters.centerMagneticLatitudeDeg,
      );
      const sampledLatitude = magneticLatitudeForDirection(hemisphere, sample);

      expect(sampledLatitude).toBeCloseTo(parameters.centerMagneticLatitudeDeg, 5);
    });
  });
});

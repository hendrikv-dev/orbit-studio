import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EARTH_RADIUS_KM } from "../physics/constants";
import {
  STAR_SKY_MIN_RADIUS_KM,
  createStarFieldMaterial,
  starCatalogPointsForQuality,
  starSkyRadiusForCameraFar,
} from "./StarField";

function expectedSceneDirection(raDeg: number, decDeg: number): Vector3 {
  const ra = raDeg * Math.PI / 180;
  const dec = decDeg * Math.PI / 180;
  return new Vector3(
    Math.cos(dec) * Math.cos(ra),
    Math.sin(dec),
    -Math.cos(dec) * Math.sin(ra),
  ).normalize();
}

function namedStar(name: string) {
  const star = starCatalogPointsForQuality("high").find((candidate) => candidate.name === name);
  if (!star) throw new Error(`Missing HYG star ${name}`);
  return star;
}

describe("authentic HYG star-layer geometry", () => {
  it("renders only the real magnitude-limited HYG v4.1 subset", () => {
    const stars = starCatalogPointsForQuality("high");
    expect(stars).toHaveLength(1839);
    expect(stars.every((star) => star.id > 0 && star.magnitude <= 5.1)).toBe(true);
    expect(stars.every((star) => star.direction.length() > 0.999_999)).toBe(true);
  });

  it.each([
    ["Sirius", 32349, 101.287155, -16.716116],
    ["Vega", 91262, 279.234735, 38.783689],
    ["Betelgeuse", 27989, 88.792939, 7.407064],
  ])("preserves the cataloged direction of %s", (name, hip, raDeg, decDeg) => {
    const star = namedStar(name as string);
    expect(star.hip).toBe(hip);
    expect(star.direction.angleTo(expectedSceneDirection(raDeg as number, decDeg as number))).toBeLessThan(
      2e-5,
    );
  });

  it("preserves the recognizable Orion belt geometry", () => {
    const mintaka = namedStar("Mintaka").direction;
    const alnilam = namedStar("Alnilam").direction;
    const alnitak = namedStar("Alnitak").direction;
    const leftSeparationDeg = mintaka.angleTo(alnilam) * 180 / Math.PI;
    const rightSeparationDeg = alnilam.angleTo(alnitak) * 180 / Math.PI;

    expect(leftSeparationDeg).toBeGreaterThan(1.25);
    expect(leftSeparationDeg).toBeLessThan(1.5);
    expect(rightSeparationDeg).toBeGreaterThan(1.25);
    expect(rightSeparationDeg).toBeLessThan(1.5);
  });

  it("preserves the recognizable Big Dipper bowl geometry", () => {
    const dubhe = namedStar("Dubhe").direction;
    const merak = namedStar("Merak").direction;
    const phecda = namedStar("Phecda").direction;
    const megrez = namedStar("Megrez").direction;
    const perimeterDeg = [
      dubhe.angleTo(merak),
      merak.angleTo(phecda),
      phecda.angleTo(megrez),
      megrez.angleTo(dubhe),
    ].map((angle) => angle * 180 / Math.PI);

    expect(perimeterDeg.every((angle) => angle > 4 && angle < 11)).toBe(true);
  });

  it("uses an origin-centered inertial shell inside the active far plane", () => {
    const farKm = EARTH_RADIUS_KM * 20_000;
    const radius = starSkyRadiusForCameraFar(farKm);
    expect(radius).toBeGreaterThan(STAR_SKY_MIN_RADIUS_KM);
    expect(radius).toBeLessThan(farKm);
  });

  it("depth-tests stars so Earth occludes the sky layer", () => {
    const material = createStarFieldMaterial();
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    material.dispose();
  });
});

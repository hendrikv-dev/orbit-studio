import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM } from "./constants";
import {
  BIELLIPTIC_ALWAYS_BETTER_RATIO,
  BIELLIPTIC_ALWAYS_WORSE_RATIO,
  biellipticTransfer,
  circularSpeedKmS,
  combinedBurnDeltaVKmS,
  exhaustVelocityKmS,
  hohmannTransfer,
  planMission,
  planeChangeDeltaVKmS,
  propellantMassFraction,
  visVivaSpeedKmS,
} from "./maneuvers";

const LEO = EARTH_RADIUS_KM + 300;
const GEO = 42164;

describe("orbital speeds", () => {
  it("reproduces the standard circular speeds", () => {
    expect(circularSpeedKmS(EARTH_RADIUS_KM + 300)).toBeCloseTo(7.726, 2);
    expect(circularSpeedKmS(GEO)).toBeCloseTo(3.0747, 3);
  });

  it("agrees with vis-viva on a circular orbit", () => {
    expect(visVivaSpeedKmS(LEO, LEO)).toBeCloseTo(circularSpeedKmS(LEO), 9);
  });
});

describe("Hohmann transfer", () => {
  it("costs the textbook budget from LEO to GEO", () => {
    const plan = hohmannTransfer(LEO, GEO);
    expect(plan.burns[0].deltaVKmS).toBeCloseTo(2.42, 1);
    expect(plan.burns[1].deltaVKmS).toBeCloseTo(1.47, 1);
    expect(plan.totalDeltaVKmS).toBeCloseTo(3.89, 1);
  });

  it("takes just over five hours to reach GEO", () => {
    // Half the period of the transfer ellipse.
    expect(hohmannTransfer(LEO, GEO).transferTimeSeconds / 3600).toBeCloseTo(5.26, 1);
  });

  it("is symmetric in cost between raising and lowering", () => {
    const up = hohmannTransfer(LEO, GEO);
    const down = hohmannTransfer(GEO, LEO);
    expect(down.totalDeltaVKmS).toBeCloseTo(up.totalDeltaVKmS, 9);
  });

  it("costs nothing to transfer to the same orbit", () => {
    expect(hohmannTransfer(LEO, LEO).totalDeltaVKmS).toBeCloseTo(0, 9);
  });
});

describe("bi-elliptic transfer", () => {
  it("loses to Hohmann below the classical ratio", () => {
    const inner = EARTH_RADIUS_KM + 300;
    const outer = inner * (BIELLIPTIC_ALWAYS_WORSE_RATIO - 1);
    const hohmann = hohmannTransfer(inner, outer).totalDeltaVKmS;
    // Even a very distant intermediate cannot beat it below the threshold.
    for (const intermediate of [outer * 2, outer * 10, outer * 100]) {
      expect(biellipticTransfer(inner, outer, intermediate).totalDeltaVKmS)
        .toBeGreaterThan(hohmann);
    }
  });

  it("beats Hohmann above the classical ratio, given a distant enough waypoint", () => {
    const inner = EARTH_RADIUS_KM + 300;
    const outer = inner * (BIELLIPTIC_ALWAYS_BETTER_RATIO + 2);
    const hohmann = hohmannTransfer(inner, outer).totalDeltaVKmS;
    expect(biellipticTransfer(inner, outer, outer * 40).totalDeltaVKmS).toBeLessThan(hohmann);
  });

  it("always costs far more time than it saves in speed", () => {
    const inner = EARTH_RADIUS_KM + 300;
    const outer = inner * 20;
    const bi = biellipticTransfer(inner, outer, outer * 40);
    expect(bi.transferTimeSeconds).toBeGreaterThan(
      hohmannTransfer(inner, outer).transferTimeSeconds * 10,
    );
  });
});

describe("plane changes", () => {
  it("costs more than the orbit's own speed beyond 60 degrees", () => {
    const speed = circularSpeedKmS(LEO);
    // 2 sin(30 deg) = 1 exactly.
    expect(planeChangeDeltaVKmS(speed, 60)).toBeCloseTo(speed, 9);
    expect(planeChangeDeltaVKmS(speed, 90)).toBeGreaterThan(speed);
  });

  it("is far cheaper where the orbit is slower", () => {
    // The reason plane changes are done at apogee, stated as a ratio.
    const low = planeChangeDeltaVKmS(circularSpeedKmS(LEO), 28.5);
    const high = planeChangeDeltaVKmS(circularSpeedKmS(GEO), 28.5);
    expect(low / high).toBeCloseTo(circularSpeedKmS(LEO) / circularSpeedKmS(GEO), 6);
    expect(low).toBeGreaterThan(high * 2);
  });

  it("reduces to the speed difference when there is no turn", () => {
    expect(combinedBurnDeltaVKmS(7.7, 10.2, 0)).toBeCloseTo(2.5, 9);
  });

  it("is never more expensive combined than done separately", () => {
    for (const angle of [5, 15, 28.5, 45, 90]) {
      const combined = combinedBurnDeltaVKmS(10.2, 1.6, angle);
      const separate = Math.abs(10.2 - 1.6) + planeChangeDeltaVKmS(1.6, angle);
      expect(combined).toBeLessThanOrEqual(separate + 1e-9);
    }
  });
});

describe("mission plan", () => {
  it("matches a plain Hohmann when no plane change is needed", () => {
    const plan = planMission(LEO, GEO, 0);
    expect(plan.totalDeltaVKmS).toBeCloseTo(plan.transfer.totalDeltaVKmS, 6);
    expect(plan.planeChangeAtArrivalFraction).toBeGreaterThanOrEqual(0);
  });

  it("puts almost all of a Cape Canaveral plane change at GEO", () => {
    // The standard LEO-to-GEO mission: 28.5 degrees, and the turn belongs at
    // apogee where the spacecraft is slowest.
    const plan = planMission(LEO, GEO, 28.5);
    expect(plan.planeChangeAtArrivalFraction).toBeGreaterThan(0.85);
    // Hand-checked: minimising the two combined burns over the split puts
    // ~2.2 degrees of the turn at departure and the rest at apogee, for
    // 4.232 km/s against 3.892 for the same transfer with no plane change.
    expect(plan.totalDeltaVKmS).toBeCloseTo(4.232, 2);
  });

  it("beats doing the plane change first, by a wide margin", () => {
    const plan = planMission(LEO, GEO, 28.5);
    expect(plan.totalDeltaVKmS).toBeLessThan(plan.naiveDeltaVKmS);
    // Roughly 3.5 km/s of savings on a real mission.
    expect(plan.naiveDeltaVKmS - plan.totalDeltaVKmS).toBeGreaterThan(1);
  });

  it("never exceeds the naive plan at any inclination", () => {
    for (const angle of [0, 5, 28.5, 51.6, 90]) {
      const plan = planMission(LEO, GEO, angle);
      expect(plan.totalDeltaVKmS).toBeLessThanOrEqual(plan.naiveDeltaVKmS + 1e-9);
    }
  });
});

describe("rocket equation", () => {
  it("converts specific impulse to exhaust velocity", () => {
    expect(exhaustVelocityKmS(300)).toBeCloseTo(2.942, 3);
    expect(exhaustVelocityKmS(450)).toBeCloseTo(4.413, 3);
  });

  it("shows most of the vehicle is propellant for a GEO transfer", () => {
    const budget = planMission(LEO, GEO, 28.5).totalDeltaVKmS;
    const fraction = propellantMassFraction(budget, exhaustVelocityKmS(320));
    expect(fraction).toBeGreaterThan(0.7);
    expect(fraction).toBeLessThan(0.85);
  });

  it("needs no propellant for no manoeuvre", () => {
    expect(propellantMassFraction(0, 3)).toBe(0);
  });
});

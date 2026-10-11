import { describe, expect, it } from "vitest";
import { Body, GeoVector, Horizon, Observer, RotateVector, Rotation_EQD_EQJ, Rotation_EQJ_ECL, SphereFromVector, SunPosition, VectorFromSphere } from "astronomy-engine";
import snapshot from "../meteors/nasa-snapshot.json";
import { METEOR_SHOWERS, METEOR_SHOWER_SNAPSHOT, isShowerActiveAt } from "./meteorShowers";
import { planIdentity, TRACKER_PLAN_MODEL_VERSION } from "./schedule";
import { trackerPlanningKey } from "./planningProtocol";
import { meteorNight, radiantEquatorialOfDate, showerPeakTime, zhrAtSolarLongitude } from "./meteorActivity";
import { trackerObservationPeriod } from "./observationPeriod";
import { upcomingMeteorShowers, showerFor } from "./eventCatalogue";
import { meteorPotentialAt } from "./meteorPotential";

// Independently transcribed/visually checked CP Table 1, printed p10 / PDF p22.
// This is source conformance, NOT an observed radiant/physical AR accuracy test.
const cpRows = [
  ["QUA",230,49.5,283.3],["LYR",272,33.3,32.4],["ETA",336.9,-1.5,46.9],
  ["CAP",306.6,-8.2,127],["SDA",342.1,-15.4,125.6],["PER",48.3,58,140.2],
  ["ORI",95.4,15.9,208.6],["STA",49.4,13,224],["NTA",58.6,21.6,224],
  ["LEO",154.2,21.6,235.1],["GEM",113.2,32.5,262.1],["URS",219.4,75.3,271],
] as const;

describe("NASA meteor source contract", () => {
  it("keys nightly and worker planning identities to the NASA replacement", () => {
    expect(TRACKER_PLAN_MODEL_VERSION).toContain(`nasa-radiants-${METEOR_SHOWER_SNAPSHOT.snapshotDate}`);
    expect(TRACKER_PLAN_MODEL_VERSION).not.toBe("phase-1-2026-08-19");
    expect(planIdentity(45.5,-122.7,"America/Los_Angeles","2026-08-14T03:00:00Z").modelVersion).toBe(TRACKER_PLAN_MODEL_VERSION);
    expect(trackerPlanningKey({kind:"nights",latitudeDeg:45.5,longitudeDeg:-122.7,fromUtc:"2026-08-14T03:00:00Z",nights:7,timeZone:"America/Los_Angeles"}).startsWith(TRACKER_PLAN_MODEL_VERSION+"|")).toBe(true);
  });
  it("contains exactly the original twelve identities, no unused parent or IAU fields", () => {
    expect(METEOR_SHOWERS.map(s => s.code)).toEqual(cpRows.map(r => r[0]));
    for (const s of METEOR_SHOWERS) {
      expect(s).not.toHaveProperty("parent");
      expect(s).not.toHaveProperty("iauNumber");
    }
  });
  it.each(cpRows)("retains the %s published J2000 anchor and reference longitude", (code,ra,dec,longitude) => {
    const s = METEOR_SHOWERS.find(s => s.code === code)!;
    expect([s.radiantRaDeg,s.radiantDecDeg,s.radiantSolarLongitudeJ2000Deg]).toEqual([ra,dec,longitude]);
  });
  // Independently published F Table 3 UT: tolerance 1 second for the inverse
  // same-model longitude search/rounding, not a meteor-forecast accuracy claim.
  it.each([
    ["QUA","2026-01-03T18:38:00Z",65],["ETA","2026-05-06T16:30:00Z",75],
    ["CAP","2026-07-31T04:30:00Z",3],["SDA","2026-07-30T00:39:00Z",20],
    ["PER","2026-08-13T14:09:00Z",92],["GEM","2026-12-14T13:00:00Z",90],
    ["URS","2026-12-22T15:54:00Z",9],
  ])("recovers the %s 2026 forecast instant/rate", (code,utc,zhr) => {
    const s = METEOR_SHOWERS.find(s => s.code === code)!;
    expect(Math.abs(showerPeakTime(s,new Date(utc as string))!.getTime()-Date.parse(utc as string))).toBeLessThan(1000);
    expect(s.nominalZhr).toBe(zhr);
  });
  it.each(snapshot.showers)("derives $code endpoints from published inclusive calendar bounds", source => {
    const s = METEOR_SHOWERS.find(s => s.code === source.code)!;
    const first = new Date(`${source.activityStart}T00:00:00Z`);
    const end = new Date(Date.parse(`${source.activityLast}T00:00:00Z`)+86400000);
    expect(s.activityStartSolarLongitudeDeg).toBeCloseTo(SunPosition(first).elon,8);
    expect(s.activityEndSolarLongitudeDeg).toBeCloseTo(SunPosition(end).elon,8);
    expect(isShowerActiveAt(s,s.activityStartSolarLongitudeDeg)).toBe(true);
    expect(isShowerActiveAt(s,s.activityEndSolarLongitudeDeg)).toBe(true);
    expect(isShowerActiveAt(s,s.activityStartSolarLongitudeDeg-0.001)).toBe(false);
    expect(isShowerActiveAt(s,s.activityEndSolarLongitudeDeg+0.001)).toBe(false);
    expect(zhrAtSolarLongitude(s,s.peakSolarLongitudeDeg)).toBeCloseTo(s.nominalZhr,10);
  });
  it("uses MEO population corrections rather than preserving old equality", () => {
    expect(METEOR_SHOWERS.find(s => s.code === "PER")!.populationIndex).toBe(2.6);
    expect(METEOR_SHOWERS.find(s => s.code === "LEO")!.populationIndex).toBe(2.9);
  });
  it.each([2026,2027])("preserves the NASA profile uncertainty for %i", year => {
    const at = new Date(`${year}-08-13T12:00:00Z`);
    const night = meteorNight(45.5,-122.7,trackerObservationPeriod(45.5,-122.7,at));
    expect(night.limitations.join(" ")).toMatch(/NASA/);
    expect(night.limitations.join(" ")).toMatch(year===2026?/coarse activity model, not a guaranteed count/:/not an outburst forecast for this year/);
  });
});

describe("J2000 anchor -> drift -> of-date contract", () => {
  it.each(cpRows)("does not re-anchor %s to a newer peak", (code) => {
    const s = METEOR_SHOWERS.find(s => s.code === code)!;
    const at = new Date("2026-11-12T12:00:00Z");
    const solarJ2000 = SphereFromVector(RotateVector(Rotation_EQJ_ECL(),GeoVector(Body.Sun,at,false))).lon;
    const zeroDrift = {...s,radiantSolarLongitudeJ2000Deg:solarJ2000};
    const actual = radiantEquatorialOfDate(zeroDrift,at);
    const back = SphereFromVector(RotateVector(Rotation_EQD_EQJ(at),VectorFromSphere({lat:actual.decDeg,lon:actual.raHours*15,dist:1},at)));
    expect(back.lon).toBeCloseTo(s.radiantRaDeg,9);
    expect(back.lat).toBeCloseTo(s.radiantDecDeg,9);
    // Calling the helper repeatedly is independent of selection or sensor pose.
    expect(radiantEquatorialOfDate(s,at)).toEqual(radiantEquatorialOfDate(s,at));
  });
  it("matches an independently written fixed-obliquity rotation/drift calculation", () => {
    const s = METEOR_SHOWERS.find(s => s.code === "NTA")!;
    const at = new Date("2026-11-12T12:00:00Z"), d = Math.PI/180;
    // IAU2006 mean J2000 obliquity: IERS2010 chapter5 eq5.40, 84381.406 arcsec.
    const obliquity = (84381.406/3600)*d;
    const eq = [Math.cos(s.radiantDecDeg*d)*Math.cos(s.radiantRaDeg*d),Math.cos(s.radiantDecDeg*d)*Math.sin(s.radiantRaDeg*d),Math.sin(s.radiantDecDeg*d)];
    const ecl = [eq[0],eq[1]*Math.cos(obliquity)+eq[2]*Math.sin(obliquity),-eq[1]*Math.sin(obliquity)+eq[2]*Math.cos(obliquity)];
    const sun = GeoVector(Body.Sun,at,false);
    const sunLon = Math.atan2(sun.y*Math.cos(obliquity)+sun.z*Math.sin(obliquity),sun.x);
    const drift = sunLon-s.radiantSolarLongitudeJ2000Deg*d;
    const shifted = [ecl[0]*Math.cos(drift)-ecl[1]*Math.sin(drift),ecl[0]*Math.sin(drift)+ecl[1]*Math.cos(drift),ecl[2]];
    const expectedEq = [shifted[0],shifted[1]*Math.cos(obliquity)-shifted[2]*Math.sin(obliquity),shifted[1]*Math.sin(obliquity)+shifted[2]*Math.cos(obliquity)];
    const actual = radiantEquatorialOfDate(s,at);
    const back = RotateVector(Rotation_EQD_EQJ(at),VectorFromSphere({lat:actual.decDeg,lon:actual.raHours*15,dist:1},at));
    // 1e-8 vector tolerance; no physical observational accuracy claim.
    expect(back.x).toBeCloseTo(expectedEq[0],8);
    expect(back.y).toBeCloseTo(expectedEq[1],8);
    expect(back.z).toBeCloseTo(expectedEq[2],8);
  });
  it.each(cpRows)("keeps %s event identity and observer/Sky contribution consistent", (code) => {
    const s = METEOR_SHOWERS.find(s => s.code === code)!;
    const source = snapshot.showers.find(row => row.code === code)!;
    const peak = showerPeakTime(s,new Date(source.peakUtc))!;
    const events = upcomingMeteorShowers(new Date("2026-01-01T00:00:00Z"),12);
    const event = events.find(e => e.detail?.showerCode === code)!;
    expect(showerFor(event)).toBe(s);
    expect(Math.abs(Date.parse(event.atUtc)-peak.getTime())).toBeLessThan(1000);
    const period = trackerObservationPeriod(45.5,-122.7,peak);
    const night = meteorNight(45.5,-122.7,period);
    const c = night.contributions.find(c => c.code === code);
    if (c && night.best) {
      const eq = radiantEquatorialOfDate(s,new Date(night.best.atUtc));
      const expected = Horizon(new Date(night.best.atUtc),new Observer(45.5,-122.7,0),eq.raHours,eq.decDeg,"normal");
      expect(c.radiantAltitudeDeg).toBeCloseTo(expected.altitude,10);
      expect(c.radiantAzimuthDeg).toBeCloseTo(expected.azimuth,10);
      expect(c.radiantTrack.length).toBe(night.samples.length);
    }
    const potential = meteorPotentialAt(s,peak,45.5,-122.7);
    expect(Number.isFinite(potential.potential)).toBe(true);
    expect(potential.potential).toBeGreaterThanOrEqual(0);
  });
});

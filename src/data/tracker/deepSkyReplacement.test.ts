import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import showpieces from "../deep-sky/showpieces.json";
import snapshot from "../deep-sky/permissive-snapshot.json";
import { deepSkyOpportunities } from "./deepSky";
import { filterSkySearch, skySearchCatalog } from "./skyExplorer";
import { guidanceForSkyTarget, positionForSkyFinderTarget, skyFinderTargetFor } from "./skyFinder";

const ids = ["m45","m44","m7","m31","ngc0869","ngc0884","m42","m6","m35","ngc0752","m13","m8","m16","m22","m15","ngc0457","m92","m81","m27","ngc7009","m82","m51","m1","m104","m57","ngc6543"];
const at = new Date("2026-10-05T05:00:00Z");
const observer = { latitudeDeg: 45.54, longitudeDeg: -122.4 };

describe("permissive 26-object production boundary", () => {
  it("preserves all identities, names and designation aliases in search", () => {
    expect(showpieces.objects.map(o=>o.id).sort()).toEqual([...ids].sort());
    const catalog = skySearchCatalog(at);
    for (const object of showpieces.objects) {
      const expected = `deep-sky-${object.id}`;
      expect(filterSkySearch(catalog, object.name, 100).some(o=>o.id===expected)).toBe(true);
      expect(filterSkySearch(catalog, object.designation, 100).some(o=>o.id===expected)).toBe(true);
      expect(catalog.find(o=>o.id===expected)?.target.source).toEqual({kind:"equatorial",rightAscensionHours:object.rightAscensionDeg/15,declinationDeg:object.declinationDeg});
    }
  });
  it("uses the authorized nebular magnitudes, not stellar photometry", () => {
    expect(showpieces.objects.find(o=>o.id==="ngc7009")?.visualMagnitude).toBe(8);
    expect(showpieces.objects.find(o=>o.id==="ngc6543")?.visualMagnitude).toBe(8.2);
    expect(showpieces.objects.find(o=>o.id==="ngc0752")?.appearance).toBe("An open cluster seen as a loose scatter of stars.");
    for (const o of showpieces.objects) expect(o.equipment).toBe(o.visualMagnitude<=4.5?"eyes":o.visualMagnitude<=7?"binoculars":"telescope");
  });
  it("reproduces the snapshot offline with its exact checksum", () => {
    const bytes = readFileSync("src/data/deep-sky/permissive-snapshot.json");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(showpieces.source.files[0].sha256);
    expect(execFileSync(process.execPath,["scripts/build-deep-sky-showpieces.mjs","--check"],{encoding:"utf8"})).toContain("PASS");
    expect(snapshot.objects).toHaveLength(26);
    expect(snapshot.sources.every(s=>/NASA|Wikidata/.test(s.provider))).toBe(true);
  });
  it("retains finite celestial projection and below-horizon classification for all objects", () => {
    const catalog = skySearchCatalog(at);
    let below=0;
    for (const id of ids) {
      const target=catalog.find(o=>o.id===`deep-sky-${id}`)!.target;
      const position=positionForSkyFinderTarget(target,observer,at)!;
      expect(Number.isFinite(position.altitudeDeg)).toBe(true);
      expect(position.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(position.azimuthDeg).toBeLessThan(360);
      if(position.altitudeDeg<0) {
        below++;
        expect(guidanceForSkyTarget(target.title,null,position,6,"good").kind).toBe("below-horizon");
      }
    }
    expect(below).toBeGreaterThan(0);
  });
  it("keeps all imagery-eligible objects in some applicable night and retains finder lookup", () => {
    const all=new Map();
    for(const month of [1,4,7,10]) for(const lat of [45.54,-35]) {
      const night={startUtc:`2027-${String(month).padStart(2,"0")}-15T00:00:00Z`,endUtc:`2027-${String(month).padStart(2,"0")}-16T00:00:00Z`};
      for(const o of deepSkyOpportunities(lat,-122.4,night)) all.set(o.id,o);
    }
    expect([...all.keys()].sort()).toEqual(ids.filter(id=>id!=="ngc0752").map(id=>`deep-sky-${id}`).sort());
    for(const o of all.values()) {
      expect(skyFinderTargetFor(o,null,true)?.id).toBe(o.id);
      if(o.finder.majorAxisArcmin===null) {
        expect(o.finder.angularRadiusDeg).toBe(0);
        expect(o.limitations.join(" ")).not.toContain("spread over a large area");
      }
      expect(o.qualities.spectacle).toBe(Math.min(0.9,Math.max(0.5,(9-showpieces.objects.find(x=>`deep-sky-${x.id}`===o.id)!.visualMagnitude)/9)));
    }
  });
});

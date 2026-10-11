import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("offline NASA meteor normalization", () => {
  it("matches the committed twelve-row output", () => {
    expect(() => execFileSync(process.execPath,["scripts/build-nasa-meteor-showers.mjs","--check"],{stdio:"pipe"})).not.toThrow();
  });
  it("fails with missing source rights, duplicate identity, or stale output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(),"tracker-nasa-normalization-"));
    try {
      await mkdir(path.join(root,"scripts"));
      await mkdir(path.join(root,"src/data/meteors"),{recursive:true});
      await copyFile("scripts/build-nasa-meteor-showers.mjs",path.join(root,"scripts/build-nasa-meteor-showers.mjs"));
      await symlink(path.resolve("node_modules"),path.join(root,"node_modules"),"dir");
      for (const file of ["nasa-snapshot.json","tracker-model.json","showers.json"]) {
        await copyFile(`src/data/meteors/${file}`,path.join(root,"src/data/meteors",file));
      }
      const source = JSON.parse(await readFile("src/data/meteors/nasa-snapshot.json","utf8"));
      const run = () => spawnSync(process.execPath,[path.join(root,"scripts/build-nasa-meteor-showers.mjs"),"--check"],{encoding:"utf8"});
      expect(run().status).toBe(0);
      const missing = structuredClone(source);
      delete missing.sources.H;
      await writeFile(path.join(root,"src/data/meteors/nasa-snapshot.json"),JSON.stringify(missing));
      expect(run().status).not.toBe(0);
      const missingFrame = structuredClone(source);
      missingFrame.sources.CP.frame = "unspecified";
      await writeFile(path.join(root,"src/data/meteors/nasa-snapshot.json"),JSON.stringify(missingFrame));
      expect(run().status).not.toBe(0);
      const missingRadiantRights = structuredClone(source);
      delete missingRadiantRights.sources.CP;
      await writeFile(path.join(root,"src/data/meteors/nasa-snapshot.json"),JSON.stringify(missingRadiantRights));
      expect(run().status).not.toBe(0);
      const duplicate = structuredClone(source);
      duplicate.showers[1].code = "QUA";
      await writeFile(path.join(root,"src/data/meteors/nasa-snapshot.json"),JSON.stringify(duplicate));
      expect(run().status).not.toBe(0);
      await writeFile(path.join(root,"src/data/meteors/nasa-snapshot.json"),JSON.stringify(source));
      await writeFile(path.join(root,"src/data/meteors/showers.json"),"{}\n");
      expect(run().status).not.toBe(0);
    } finally {
      await rm(root,{recursive:true,force:true});
    }
  }, 30_000); // Six isolated Node processes; not a product timing/accuracy tolerance.
});

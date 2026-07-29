import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
});

try {
  const catalog = await server.ssrLoadModule("/src/data/explorerCatalog.ts");
  const propagation = await server.ssrLoadModule("/src/lib/propagation.ts");
  const coordinates = await server.ssrLoadModule("/src/rendering/coordinates.ts");
  const kepler = await server.ssrLoadModule("/src/physics/kepler.ts");
  const stars = await server.ssrLoadModule("/src/data/stars/hygBrightStars.v41.json");
  const snapshot = catalog.explorerSnapshots[catalog.explorerSnapshots.length - 1];
  const createStarted = performance.now();
  const scenario = catalog.createExplorerScenario(snapshot);
  const scenarioCreateMs = performance.now() - createStarted;
  const date = new Date(snapshot.timestampIso);

  const propagateBatch = (withVectorAllocation) => {
    let checksum = 0;
    let failures = 0;
    const started = performance.now();
    for (const satellite of scenario.satellites) {
      try {
        const state = propagation.propagateSatellite(satellite, date);
        if (withVectorAllocation) {
          const vector = coordinates.eciToThreeVector(state.positionKm);
          checksum += vector.x + vector.y + vector.z;
        } else {
          checksum += state.positionKm[0] + state.positionKm[1] + state.positionKm[2];
        }
      } catch {
        failures += 1;
      }
    }
    return { ms: performance.now() - started, checksum, failures };
  };

  const coldPropagation = propagateBatch(false);
  const warmPropagation = [propagateBatch(false), propagateBatch(false), propagateBatch(false)];
  const warmWithVectorAllocation = [
    propagateBatch(true),
    propagateBatch(true),
    propagateBatch(true),
  ];
  const sampleSatellite = scenario.satellites.find(
    (satellite) => satellite.id === "explorer-iss",
  ) ?? scenario.satellites[0];
  const orbitTimes = [];

  for (let run = 0; run < 10; run += 1) {
    const started = performance.now();
    for (let index = 0; index <= 640; index += 1) {
      kepler.keplerianToCartesian({
        ...sampleSatellite.keplerian,
        trueAnomalyDeg: sampleSatellite.keplerian.trueAnomalyDeg + (360 * index) / 640,
      });
    }
    orbitTimes.push(performance.now() - started);
  }

  console.log(JSON.stringify({
    counts: {
      total: scenario.satellites.length,
      sgp4: scenario.satellites.filter((item) => item.propagationMode === "sgp4").length,
      stars: stars.default.length,
    },
    scenarioCreateMs,
    coldPropagationMs: coldPropagation.ms,
    propagationFailures: coldPropagation.failures,
    warmPropagationMs: warmPropagation.map((result) => result.ms),
    warmWithVectorAllocationMs: warmWithVectorAllocation.map((result) => result.ms),
    orbit640SampleMs: orbitTimes,
  }, null, 2));
} finally {
  await server.close();
}

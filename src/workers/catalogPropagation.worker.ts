import type {
  CatalogPropagationResultMessage,
  CatalogPropagationSatellite,
  CatalogPropagationWorkerMessage,
} from "../rendering/catalogPropagationMessages";
import { propagateCatalogHorizon } from "../rendering/catalogPropagation";

let satellites: CatalogPropagationSatellite[] = [];

self.onmessage = (event: MessageEvent<CatalogPropagationWorkerMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    satellites = message.satellites;
    return;
  }

  const startedAt = performance.now();
  const sampleTimestampsMs = new Float64Array(message.sampleTimestampsMs);
  const { positions, velocities, valid } = propagateCatalogHorizon(
    satellites,
    sampleTimestampsMs,
  );

  const result: CatalogPropagationResultMessage = {
    type: "result",
    requestId: message.requestId,
    sampleTimestampsMs: sampleTimestampsMs.buffer,
    durationMs: performance.now() - startedAt,
    positions: positions.buffer,
    velocities: velocities.buffer,
    valid: valid.buffer,
  };
  self.postMessage(result, {
    transfer: [
      sampleTimestampsMs.buffer,
      positions.buffer,
      velocities.buffer,
      valid.buffer,
    ],
  });
};

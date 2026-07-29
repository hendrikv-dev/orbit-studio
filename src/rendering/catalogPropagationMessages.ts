import type { KeplerianElements } from "../physics/types";
import type { TleData } from "../physics/tle";
import type { PropagationMode } from "../lib/scenario";

export interface CatalogPropagationSatellite {
  propagationMode: PropagationMode;
  keplerian: KeplerianElements;
  tle?: TleData;
}

export interface CatalogPropagationInitMessage {
  type: "init";
  satellites: CatalogPropagationSatellite[];
}

export interface CatalogPropagationRequestMessage {
  type: "propagate";
  requestId: number;
  sampleTimestampsMs: Float64Array;
}

export interface CatalogPropagationResultMessage {
  type: "result";
  requestId: number;
  sampleTimestampsMs: ArrayBuffer;
  durationMs: number;
  positions: ArrayBuffer;
  velocities: ArrayBuffer;
  valid: ArrayBuffer;
}

export type CatalogPropagationWorkerMessage =
  | CatalogPropagationInitMessage
  | CatalogPropagationRequestMessage;

/// <reference lib="webworker" />

import { planMonth, planNights } from "../data/tracker/schedule";
import type {
  TrackerPlanningRequest,
  TrackerPlanningResponse,
} from "../data/tracker/planningProtocol";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<TrackerPlanningRequest>) => {
  const request = event.data;
  const progress = (completed: number, total: number) => {
    const response: TrackerPlanningResponse = { type: "progress", completed, total };
    workerScope.postMessage(response);
  };

  try {
    const plans =
      request.kind === "nights"
        ? planNights(
            request.latitudeDeg,
            request.longitudeDeg,
            new Date(request.fromUtc),
            request.nights,
            request.timeZone,
            progress,
          )
        : planMonth(
            request.latitudeDeg,
            request.longitudeDeg,
            request.year,
            request.month,
            request.timeZone,
            progress,
          );
    const response: TrackerPlanningResponse = { type: "result", plans };
    workerScope.postMessage(response);
  } catch (error) {
    const response: TrackerPlanningResponse = {
      type: "error",
      message: error instanceof Error ? error.message : "Planning failed.",
    };
    workerScope.postMessage(response);
  }
};

export {};

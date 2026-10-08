import { TRACKER_PLAN_MODEL_VERSION, type NightPlan } from "./schedule";

export type TrackerPlanningRequest =
  | {
      kind: "nights";
      latitudeDeg: number;
      longitudeDeg: number;
      fromUtc: string;
      nights: number;
      timeZone: string | null;
    }
  | {
      kind: "month";
      latitudeDeg: number;
      longitudeDeg: number;
      year: number;
      month: number;
      timeZone: string | null;
    };

export type TrackerPlanningResponse =
  | { type: "progress"; completed: number; total: number }
  | { type: "result"; plans: NightPlan[] }
  | { type: "error"; message: string };

/** Complete cache identity for an expensive planning request. */
export function trackerPlanningKey(request: TrackerPlanningRequest): string {
  const authority = [
    TRACKER_PLAN_MODEL_VERSION,
    request.kind,
    request.latitudeDeg.toFixed(6),
    request.longitudeDeg.toFixed(6),
    request.timeZone ?? "UTC",
  ];
  if (request.kind === "nights") {
    authority.push(request.fromUtc, String(request.nights));
  } else {
    authority.push(String(request.year), String(request.month));
  }
  return authority.join("|");
}

export function trackerPlanningTotal(request: TrackerPlanningRequest): number {
  return request.kind === "nights"
    ? request.nights
    : new Date(Date.UTC(request.year, request.month, 0)).getUTCDate();
}

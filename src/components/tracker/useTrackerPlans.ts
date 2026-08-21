import { useEffect, useState } from "react";
import {
  peekTrackerPlans,
  subscribeTrackerPlans,
} from "../../data/tracker/planningClient";
import {
  trackerPlanningKey,
  trackerPlanningTotal,
  type TrackerPlanningRequest,
} from "../../data/tracker/planningProtocol";
import type { NightPlan } from "../../data/tracker/schedule";

export type TrackerPlansState =
  | { status: "loading"; plans: null; completed: number; total: number }
  | { status: "ready"; plans: NightPlan[]; completed: number; total: number; cached: boolean }
  | { status: "error"; plans: null; completed: number; total: number; message: string };

export function useTrackerPlans(request: TrackerPlanningRequest, retryNonce = 0): TrackerPlansState {
  const key = trackerPlanningKey(request);
  const total = trackerPlanningTotal(request);
  const [snapshot, setSnapshot] = useState<{ key: string; state: TrackerPlansState }>(() => {
    const plans = peekTrackerPlans(request);
    return {
      key,
      state: plans
        ? { status: "ready", plans, completed: total, total, cached: true }
        : { status: "loading", plans: null, completed: 0, total },
    };
  });

  useEffect(() => {
    let active = true;
    const held = peekTrackerPlans(request);
    if (held) {
      setSnapshot({ key, state: { status: "ready", plans: held, completed: total, total, cached: true } });
      return;
    }

    setSnapshot({ key, state: { status: "loading", plans: null, completed: 0, total } });
    const subscription = subscribeTrackerPlans(request, (completed, progressTotal) => {
      if (active) {
        setSnapshot({
          key,
          state: { status: "loading", plans: null, completed, total: progressTotal },
        });
      }
    });
    void subscription.promise.then(
      (plans) => {
        if (active) {
          setSnapshot({
            key,
            state: { status: "ready", plans, completed: total, total, cached: subscription.cached },
          });
        }
      },
      (error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setSnapshot({
          key,
          state: {
            status: "error",
            plans: null,
            completed: 0,
            total,
            message: error instanceof Error ? error.message : "Planning failed.",
          },
        });
      },
    );
    return () => {
      active = false;
      subscription.cancel();
    };
  }, [key, request, retryNonce, total]);

  return snapshot.key === key
    ? snapshot.state
    : { status: "loading", plans: null, completed: 0, total };
}

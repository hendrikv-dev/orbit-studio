import type { NightPlan } from "./schedule";
import {
  trackerPlanningKey,
  type TrackerPlanningRequest,
  type TrackerPlanningResponse,
} from "./planningProtocol";

interface PlanningWorker {
  onmessage: ((event: MessageEvent<TrackerPlanningResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: TrackerPlanningRequest): void;
  terminate(): void;
}

type PlanningWorkerFactory = () => PlanningWorker;
type ProgressListener = (completed: number, total: number) => void;

interface PlanningTask {
  worker: PlanningWorker;
  promise: Promise<NightPlan[]>;
  reject: (reason: Error) => void;
  subscribers: number;
  progressListeners: Set<ProgressListener>;
  settled: boolean;
}

const MAX_CACHE_ENTRIES = 8;
const cache = new Map<string, NightPlan[]>();
const inFlight = new Map<string, PlanningTask>();

let testWorkerFactory: PlanningWorkerFactory | null = null;

function createWorker(): PlanningWorker {
  if (testWorkerFactory) return testWorkerFactory();
  return new Worker(new URL("../../workers/trackerPlanning.worker.ts", import.meta.url), {
    type: "module",
    name: "tracker-planning",
  });
}

function cachePlans(key: string, plans: NightPlan[]): void {
  cache.delete(key);
  cache.set(key, plans);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function peekTrackerPlans(request: TrackerPlanningRequest): NightPlan[] | null {
  const key = trackerPlanningKey(request);
  const held = cache.get(key) ?? null;
  if (held) {
    cache.delete(key);
    cache.set(key, held);
  }
  return held;
}

function taskFor(request: TrackerPlanningRequest): PlanningTask {
  const key = trackerPlanningKey(request);
  const held = inFlight.get(key);
  if (held) return held;

  const worker = createWorker();
  let resolvePromise!: (plans: NightPlan[]) => void;
  let rejectPromise!: (reason: Error) => void;
  const promise = new Promise<NightPlan[]>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const task: PlanningTask = {
    worker,
    promise,
    reject: rejectPromise,
    subscribers: 0,
    progressListeners: new Set(),
    settled: false,
  };
  inFlight.set(key, task);

  const fail = (message: string) => {
    if (task.settled) return;
    task.settled = true;
    inFlight.delete(key);
    worker.terminate();
    rejectPromise(new Error(message));
  };

  worker.onmessage = (event) => {
    if (task.settled || inFlight.get(key) !== task) return;
    const response = event.data;
    if (response.type === "progress") {
      for (const listener of task.progressListeners) {
        listener(response.completed, response.total);
      }
      return;
    }
    if (response.type === "error") {
      fail(response.message);
      return;
    }
    task.settled = true;
    inFlight.delete(key);
    worker.terminate();
    cachePlans(key, response.plans);
    resolvePromise(response.plans);
  };
  worker.onerror = (event) => fail(event.message || "The planning worker failed.");
  worker.postMessage(request);
  return task;
}

export interface TrackerPlanningSubscription {
  cached: boolean;
  promise: Promise<NightPlan[]>;
  cancel(): void;
}

/**
 * Subscribe to one authoritative request. The last cancellation terminates its
 * worker, so late work for an old place or month cannot overwrite newer state.
 */
export function subscribeTrackerPlans(
  request: TrackerPlanningRequest,
  onProgress?: ProgressListener,
): TrackerPlanningSubscription {
  const cached = peekTrackerPlans(request);
  if (cached) {
    return { cached: true, promise: Promise.resolve(cached), cancel() {} };
  }

  const key = trackerPlanningKey(request);
  const task = taskFor(request);
  task.subscribers += 1;
  if (onProgress) task.progressListeners.add(onProgress);
  let active = true;

  return {
    cached: false,
    promise: task.promise,
    cancel() {
      if (!active) return;
      active = false;
      task.subscribers -= 1;
      if (onProgress) task.progressListeners.delete(onProgress);
      if (task.subscribers === 0 && !task.settled && inFlight.get(key) === task) {
        task.settled = true;
        inFlight.delete(key);
        task.worker.terminate();
        task.reject(new DOMException("Planning superseded.", "AbortError"));
      }
    },
  };
}

/** Test-only reset for deterministic cache and cancellation assertions. */
export function resetTrackerPlanningClientForTests(factory: PlanningWorkerFactory | null = null): void {
  for (const task of inFlight.values()) task.worker.terminate();
  inFlight.clear();
  cache.clear();
  testWorkerFactory = factory;
}

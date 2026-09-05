import { afterEach, describe, expect, it } from "vitest";
import {
  resetTrackerPlanningClientForTests,
  subscribeTrackerPlans,
} from "./planningClient";
import type { TrackerPlanningRequest, TrackerPlanningResponse } from "./planningProtocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<TrackerPlanningResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  request: TrackerPlanningRequest | null = null;
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: TrackerPlanningRequest) {
    this.request = request;
  }

  terminate() {
    this.terminated = true;
  }

  emit(response: TrackerPlanningResponse) {
    this.onmessage?.({ data: response } as MessageEvent<TrackerPlanningResponse>);
  }
}

const REQUEST: TrackerPlanningRequest = {
  kind: "nights",
  latitudeDeg: 45.5152,
  longitudeDeg: -122.6784,
  fromUtc: "2026-08-20T12:00:00.000Z",
  nights: 30,
  timeZone: "America/Los_Angeles",
};

function installFakeWorker() {
  FakeWorker.instances = [];
  resetTrackerPlanningClientForTests(() => new FakeWorker());
}

afterEach(() => resetTrackerPlanningClientForTests());

describe("Tracker planning client", () => {
  it("shares one authoritative request and reports worker progress", async () => {
    installFakeWorker();
    const progress: string[] = [];
    const first = subscribeTrackerPlans(REQUEST, (done, total) => progress.push(`${done}/${total}`));
    const second = subscribeTrackerPlans(REQUEST);

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].request).toEqual(REQUEST);
    FakeWorker.instances[0].emit({ type: "progress", completed: 4, total: 30 });
    FakeWorker.instances[0].emit({ type: "result", plans: [] });

    await expect(first.promise).resolves.toEqual([]);
    await expect(second.promise).resolves.toEqual([]);
    expect(progress).toEqual(["4/30"]);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("serves completed plans from cache without starting another worker", async () => {
    installFakeWorker();
    const first = subscribeTrackerPlans(REQUEST);
    FakeWorker.instances[0].emit({ type: "result", plans: [] });
    await first.promise;

    const cached = subscribeTrackerPlans(REQUEST);
    expect(cached.cached).toBe(true);
    await expect(cached.promise).resolves.toEqual([]);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("terminates work only when the last subscriber cancels", async () => {
    installFakeWorker();
    const first = subscribeTrackerPlans(REQUEST);
    const second = subscribeTrackerPlans(REQUEST);
    const rejection = expect(second.promise).rejects.toMatchObject({ name: "AbortError" });

    first.cancel();
    expect(FakeWorker.instances[0].terminated).toBe(false);
    second.cancel();
    expect(FakeWorker.instances[0].terminated).toBe(true);
    await rejection;
  });

  it("ignores a late result from superseded work", async () => {
    installFakeWorker();
    const subscription = subscribeTrackerPlans(REQUEST);
    const rejection = expect(subscription.promise).rejects.toMatchObject({ name: "AbortError" });
    const worker = FakeWorker.instances[0];
    subscription.cancel();
    worker.emit({ type: "result", plans: [] });
    await rejection;

    const replacement = subscribeTrackerPlans(REQUEST);
    expect(replacement.cached).toBe(false);
    expect(FakeWorker.instances).toHaveLength(2);
    replacement.cancel();
    await expect(replacement.promise).rejects.toMatchObject({ name: "AbortError" });
  });
});

import { describe, expect, it } from "vitest";
import { detectBrowser, outcomeForError, recoverySteps } from "./geolocation";

/**
 * The reported fault was silence: a button that, in a browser which had already
 * blocked the site, produced no prompt, no error and no way out. These assert
 * that every failure now carries something the reader can act on.
 */
describe("telling the failures apart", () => {
  it("names a block as a block, and offers a way out of it", () => {
    const outcome = outcomeForError({ code: 1, message: "denied" }, "chrome");
    expect(outcome.phase).toBe("denied");
    expect(outcome.recovery).not.toBeNull();
    expect(outcome.retryable).toBe(false);
  });

  it("treats a timeout as worth retrying, and says nothing about permissions", () => {
    const outcome = outcomeForError({ code: 3, message: "timeout" }, "chrome");
    expect(outcome.phase).toBe("timeout");
    expect(outcome.retryable).toBe(true);
    expect(outcome.recovery).toBeNull();
    expect(outcome.message).not.toMatch(/block|permission|denied/i);
  });

  it("treats an unavailable fix as the device's problem, not the user's", () => {
    const outcome = outcomeForError({ code: 2, message: "unavailable" }, "chrome");
    expect(outcome.phase).toBe("unavailable");
    expect(outcome.retryable).toBe(true);
    expect(outcome.message).not.toMatch(/block|permission/i);
  });

  it("never leaves a failure without either a way out or a retry", () => {
    for (const code of [1, 2, 3]) {
      const outcome = outcomeForError({ code, message: "" }, "chrome");
      expect(outcome.recovery !== null || outcome.retryable).toBe(true);
      expect(outcome.message.length).toBeGreaterThan(20);
    }
  });
});

describe("recovery steps name the actual control", () => {
  it("detects the browser, testing the specific tokens before the shared ones", () => {
    // Every Chromium browser claims to be Chrome and Chrome claims to be Safari,
    // so order is the whole of this function.
    expect(detectBrowser("Mozilla/5.0 Chrome/148 Safari/537.36")).toBe("chrome");
    expect(detectBrowser("Mozilla/5.0 Chrome/148 Safari/537.36 Edg/148")).toBe("edge");
    expect(detectBrowser("Mozilla/5.0 Gecko Firefox/130")).toBe("firefox");
    expect(detectBrowser("Mozilla/5.0 Version/17 Safari/605.1.15")).toBe("safari");
    expect(detectBrowser("SomeBot/1.0")).toBe("other");
  });

  it("gives each browser its own instructions, and always ends with a reload", () => {
    for (const browser of ["chrome", "edge", "firefox", "safari", "other"] as const) {
      const steps = recoverySteps(browser);
      expect(steps.length).toBeGreaterThanOrEqual(3);
      expect(steps[steps.length - 1]).toMatch(/reload/i);
    }
    // Generic advice is close to useless when the control is somewhere
    // different in every browser, so the wording must actually differ.
    expect(recoverySteps("chrome")).not.toEqual(recoverySteps("firefox"));
    expect(recoverySteps("safari")).not.toEqual(recoverySteps("chrome"));
    expect(recoverySteps("safari").join(" ")).toMatch(/Settings/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import type { FinderCapabilities } from "../../data/tracker/skyFinder";
import { beginSkyFinderLaunch } from "./SkyFinder";

const phone: FinderCapabilities = {
  deviceClass: "handheld",
  handheldEligible: true,
  secureContext: true,
  camera: true,
  geolocation: true,
  orientation: true,
  absoluteOrientation: true,
  motion: true,
  gyroscope: true,
  magneticHeading: true,
  screenOrientation: true,
  orientationPermissionRequest: true,
  motionPermissionRequest: true,
};

describe("Sky Finder launch gesture", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts camera, orientation and motion from the original target action", async () => {
    const attempts: string[] = [];
    class Orientation {}
    Object.assign(Orientation, {
      requestPermission: () => {
        attempts.push("orientation");
        return Promise.resolve("granted");
      },
    });
    class Motion {}
    Object.assign(Motion, {
      requestPermission: () => {
        attempts.push("motion");
        return Promise.resolve("granted");
      },
    });
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    vi.stubGlobal("window", { DeviceOrientationEvent: Orientation, DeviceMotionEvent: Motion });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () => {
          attempts.push("camera");
          return Promise.resolve(stream);
        },
      },
    });

    const launch = beginSkyFinderLaunch("planet-saturn", phone, true);
    expect(launch).not.toBeNull();
    // All protected calls happen before any promise settles: still inside the
    // action's user-activation task.
    expect(attempts).toEqual(["orientation", "motion", "camera"]);
    await expect(launch!.sensor).resolves.toBe("granted");
    await expect(launch!.camera).resolves.toMatchObject({ phase: "active", stream });
  });

  it("does not touch protected APIs for unsupported devices or selected dates", () => {
    const request = vi.fn();
    vi.stubGlobal("window", { DeviceOrientationEvent: { requestPermission: request } });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: request } });
    expect(beginSkyFinderLaunch("planet-saturn", { ...phone, deviceClass: "desktop", handheldEligible: false }, true)).toBeNull();
    expect(beginSkyFinderLaunch("planet-saturn", { ...phone, camera: false }, true)).toBeNull();
    expect(beginSkyFinderLaunch("planet-saturn", { ...phone, orientation: false }, true)).toBeNull();
    expect(beginSkyFinderLaunch("planet-saturn", phone, false)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

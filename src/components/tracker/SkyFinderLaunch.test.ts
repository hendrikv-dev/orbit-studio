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

  it("starts orientation and motion but leaves camera to the explicit toggle", async () => {
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
    // Sensor calls happen inside the target action. Camera is deliberately not
    // requested by navigation: rendered Sky is the base and Camera is a toggle.
    expect(attempts).toEqual(["orientation", "motion"]);
    await expect(launch!.sensor).resolves.toBe("granted");
    expect(launch!.camera).toBeNull();
  });

  it("starts orientation from direct Sky navigation without inventing a target", async () => {
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
    vi.stubGlobal("window", { DeviceOrientationEvent: Orientation, DeviceMotionEvent: Motion });

    const launch = beginSkyFinderLaunch(null, phone, true);
    expect(launch?.targetId).toBeNull();
    expect(attempts).toEqual(["orientation", "motion"]);
    await expect(launch!.sensor).resolves.toBe("granted");
  });

  it("does not touch protected APIs for unsupported devices or selected dates", () => {
    const request = vi.fn();
    vi.stubGlobal("window", { DeviceOrientationEvent: { requestPermission: request } });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: request } });
    expect(beginSkyFinderLaunch("planet-saturn", { ...phone, deviceClass: "desktop", handheldEligible: false }, true)).toBeNull();
    expect(beginSkyFinderLaunch("planet-saturn", { ...phone, camera: false }, true)).not.toBeNull();
    expect(beginSkyFinderLaunch("planet-saturn", { ...phone, orientation: false }, true)).toBeNull();
    expect(beginSkyFinderLaunch("planet-saturn", phone, false)).toBeNull();
    // The camera-less handheld is still a valid rendered Sky device, so its
    // one call is the orientation request. No call came from the other cases.
    expect(request).toHaveBeenCalledTimes(1);
  });
});

/// <reference types="vite/client" />

interface Window {
  __ORBIT_STUDIO_REVIEW__?: import("./review/reviewBridge").OrbitStudioReviewBridge;
  __ORBIT_STUDIO_FRAME_PROFILES__?: Array<{
    mode: "explorer" | "playground";
    sample: number;
    durationMs: number;
    frames: number;
    meanFrameMs: number;
    p50FrameMs: number;
    p95FrameMs: number;
    p99FrameMs: number;
    maxFrameMs: number;
    over20ms: number;
    over33ms: number;
    longTaskCount: number;
    longTaskTotalMs: number;
    longTaskMaxMs: number;
    mutations: number;
  }>;
  __ORBIT_STUDIO_POPULATION_DIAGNOSTICS__?: {
    playbackTimeMs: number;
    satelliteCount: number;
    validPositionCount: number;
    updateDurationMs: number;
    samples: Array<{
      id: string;
      catalogNumber?: string;
      categoryId?: string;
      position: [number, number, number];
    }>;
  };
}

interface ImportMetaEnv {
  readonly VITE_SUPPORT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

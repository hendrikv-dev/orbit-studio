/// <reference types="vite/client" />

interface Window {
  __ORBIT_STUDIO_REVIEW__?: import("./review/reviewBridge").OrbitStudioReviewBridge;
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

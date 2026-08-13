import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  angularSeparationDeg,
  coverageEnvelope,
  orbitalPeriodMinutes,
  splitTrackAtDateline,
  stationIsReachable,
  visibilityAngularRadiusDeg,
  type CoverageStation,
  type OrbitShape,
  type SubSatellitePoint,
} from "../../data/explorerCoverage";

const MAP_IMAGE = "/earth/nasa-blue-marble-january-5400.jpg";

export interface CoverageMapSeries {
  id: string;
  name: string;
  /** Amber for the selected object, cyan for whatever it is compared against. */
  colorTrack: string;
  colorBand: string;
  shape: OrbitShape;
  /**
   * Static ground-track geometry, anchored to the selected snapshot rather than
   * the playback clock. Its shape is sourced; only its longitude placement comes
   * from the reconstructed phase. Swapping this provider for TLE-derived state
   * makes the same view true without changing anything here.
   */
  track: readonly SubSatellitePoint[];
  /**
   * The animated sub-satellite point for the current playback time. One
   * propagation step per frame — the track behind it never recomputes.
   */
  marker: SubSatellitePoint | null;
}

interface ExplorerCoverageMapProps {
  /** One entry normally; two in comparison mode, drawn on the same map. */
  series: readonly CoverageMapSeries[];
  trackIsReconstructed: boolean;
  stations: readonly CoverageStation[];
  selectedStationId: string | null;
  onSelectStation: (id: string) => void;
  variant: "docked" | "expanded";
  onToggleExpanded: () => void;
}

interface MapGeometry {
  width: number;
  height: number;
}

const project = (latitudeDeg: number, longitudeDeg: number, geometry: MapGeometry) => ({
  x: ((longitudeDeg + 180) / 360) * geometry.width,
  y: ((90 - latitudeDeg) / 180) * geometry.height,
});

/**
 * A visibility circle is a spherical cap, which is not a circle once projected.
 * Sampling the cap's boundary keeps the drawn shape honest at high latitude,
 * where a naive ellipse would understate the covered area badly.
 */
function capOutline(
  centreLatDeg: number,
  centreLonDeg: number,
  radiusDeg: number,
  samples = 128,
): { latitudeDeg: number; longitudeDeg: number }[] {
  const toRad = Math.PI / 180;
  const lat = centreLatDeg * toRad;
  const lon = centreLonDeg * toRad;
  const radius = radiusDeg * toRad;
  const points: { latitudeDeg: number; longitudeDeg: number }[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const bearing = (index / samples) * 2 * Math.PI;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(radius) + Math.cos(lat) * Math.sin(radius) * Math.cos(bearing),
    );
    const pointLon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(radius) * Math.cos(lat),
        Math.cos(radius) - Math.sin(lat) * Math.sin(pointLat),
      );
    points.push({ latitudeDeg: pointLat / toRad, longitudeDeg: (pointLon / toRad) });
  }
  return points;
}

function drawCap(
  context: CanvasRenderingContext2D,
  geometry: MapGeometry,
  centreLatDeg: number,
  centreLonDeg: number,
  radiusDeg: number,
  fill: string,
  stroke: string,
  samples = 128,
) {
  if (radiusDeg <= 0) return;
  const outline = capOutline(centreLatDeg, centreLonDeg, radiusDeg, samples);
  // Draw the cap three times, offset by a world width, so a cap straddling the
  // antimeridian appears on both edges instead of being clipped away.
  for (const offset of [-360, 0, 360]) {
    context.beginPath();
    outline.forEach((point, index) => {
      const at = project(point.latitudeDeg, point.longitudeDeg + offset, geometry);
      if (index === 0) context.moveTo(at.x, at.y);
      else context.lineTo(at.x, at.y);
    });
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = 1.2;
    context.stroke();
  }
}

export function ExplorerCoverageMap({
  series,
  trackIsReconstructed,
  stations,
  selectedStationId,
  onSelectStation,
  variant,
  onToggleExpanded,
}: ExplorerCoverageMapProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [geometry, setGeometry] = useState<MapGeometry>({ width: 0, height: 0 });
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null);

  // Drawing a whole day of revolutions produces an unreadable mesh, so each
  // object shows about one and a half revolutions: enough to see the track's
  // shape and the westward shift between successive passes.
  const drawSeries = useMemo(
    () =>
      series.map((item) => {
        const envelope = coverageEnvelope(item.shape, 5);
        const periodMinutes = orbitalPeriodMinutes(item.shape.semiMajorAltitudeKm);
        let displayTrack = item.track;
        if (item.track.length >= 3) {
          const stepMs = item.track[1].timeMs - item.track[0].timeMs;
          if (stepMs > 0) {
            const wanted = Math.round((periodMinutes * 60 * 1000 * 1.5) / stepMs);
            displayTrack = item.track.slice(0, Math.max(2, Math.min(item.track.length, wanted)));
          }
        }
        return { ...item, envelope, displayTrack };
      }),
    [series],
  );

  useEffect(() => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => setMapImage(image);
    image.src = MAP_IMAGE;
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setGeometry({ width: box.width, height: box.height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Static layer: basemap, coverage band, graticule, station circles and the
  // ground track. None of it depends on the playback clock, so it is rendered
  // once per selection and blitted each frame.
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);

  useEffect(() => {
    if (geometry.width <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scene = sceneRef.current ?? document.createElement("canvas");
    sceneRef.current = scene;
    scene.width = Math.round(geometry.width * dpr);
    scene.height = Math.round(geometry.height * dpr);
    const context = scene.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, geometry.width, geometry.height);

    // --- basemap ---------------------------------------------------------
    context.fillStyle = "#050a12";
    context.fillRect(0, 0, geometry.width, geometry.height);
    if (mapImage) {
      context.globalAlpha = 0.55;
      context.drawImage(mapImage, 0, 0, geometry.width, geometry.height);
      context.globalAlpha = 1;
    }

    // --- coverage bands --------------------------------------------------
    // Everything between these latitudes falls inside the footprint at some
    // point in the orbit. Pure geometry from sourced inclination and altitude,
    // so it holds regardless of where the object actually is. In comparison
    // mode the two bands nest, which is the fastest read of "who sees more".
    context.setLineDash([5, 4]);
    context.lineWidth = 1;
    for (const item of drawSeries) {
      const bandTop = project(item.envelope.coveredLimitDeg, -180, geometry).y;
      const bandBottom = project(-item.envelope.coveredLimitDeg, -180, geometry).y;
      context.fillStyle = item.colorBand;
      context.fillRect(0, bandTop, geometry.width, bandBottom - bandTop);
      context.strokeStyle = item.colorTrack;
      context.globalAlpha = 0.45;
      for (const y of [bandTop, bandBottom]) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(geometry.width, y);
        context.stroke();
      }
      context.globalAlpha = 1;
    }
    context.setLineDash([]);

    // --- graticule -------------------------------------------------------
    context.strokeStyle = "rgba(126, 154, 176, 0.16)";
    context.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = project(0, lon, geometry).x;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, geometry.height);
      context.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = project(lat, 0, geometry).y;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(geometry.width, y);
      context.stroke();
    }

    // --- station visibility circles --------------------------------------
    // A station's visibility circle depends on the altitude of the object it is
    // watching, so each object that can reach a station gets its own circle in
    // its own colour. Sizing every circle from the primary object would draw a
    // 420 km footprint and label it as a 700 km one.
    for (const station of stations) {
      const reachers = drawSeries.filter((item) => stationIsReachable(station, item.shape));
      if (reachers.length === 0) {
        drawCap(
          context, geometry, station.latitudeDeg, station.longitudeDeg,
          visibilityAngularRadiusDeg(
            drawSeries[0]?.shape.semiMajorAltitudeKm ?? 0, station.minimumElevationDeg,
          ),
          "rgba(150, 160, 172, 0.05)", "rgba(150, 160, 172, 0.22)",
        );
        continue;
      }
      const selected = station.id === selectedStationId;
      for (const item of reachers) {
        drawCap(
          context, geometry, station.latitudeDeg, station.longitudeDeg,
          visibilityAngularRadiusDeg(item.shape.semiMajorAltitudeKm, station.minimumElevationDeg),
          drawSeries.length > 1
            ? "rgba(120, 226, 168, 0.055)"
            : selected ? "rgba(120, 226, 168, 0.20)" : "rgba(120, 226, 168, 0.09)",
          drawSeries.length > 1
            ? item.colorTrack
            : selected ? "rgba(140, 240, 186, 0.85)" : "rgba(120, 226, 168, 0.38)",
        );
      }
    }

    // --- ground tracks ---------------------------------------------------
    context.lineWidth = 1.6;
    if (trackIsReconstructed) context.setLineDash([6, 4]);
    for (const item of drawSeries) {
      context.strokeStyle = item.colorTrack;
      context.globalAlpha = trackIsReconstructed ? 0.72 : 1;
      for (const segment of splitTrackAtDateline(item.displayTrack)) {
        context.beginPath();
        segment.forEach((point, index) => {
          const at = project(point.latitudeDeg, point.longitudeDeg, geometry);
          if (index === 0) context.moveTo(at.x, at.y);
          else context.lineTo(at.x, at.y);
        });
        context.stroke();
      }
    }
    context.globalAlpha = 1;
    context.setLineDash([]);

    // --- station markers -------------------------------------------------
    for (const station of stations) {
      const reachers = drawSeries.filter((item) => stationIsReachable(station, item.shape));
      const at = project(station.latitudeDeg, station.longitudeDeg, geometry);
      const selected = station.id === selectedStationId;
      context.beginPath();
      context.arc(at.x, at.y, selected ? 6 : 4.5, 0, Math.PI * 2);
      context.fillStyle = reachers.length === 0
        ? "#7a8592"
        : reachers.length === drawSeries.length ? "#6ee7a8" : reachers[0].colorTrack;
      context.fill();
      context.strokeStyle = "rgba(4, 10, 18, 0.9)";
      context.lineWidth = 1.5;
      context.stroke();
    }

    setSceneVersion((current) => current + 1);
  }, [drawSeries, geometry, mapImage, selectedStationId, stations, trackIsReconstructed]);

  // Animated layer: blit the static map, then draw only the sub-satellite point
  // and its instantaneous footprint. This is the sole per-frame cost.
  useEffect(() => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene || geometry.width <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = scene.width;
    canvas.height = scene.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(scene, 0, 0);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const item of drawSeries) {
      const head = item.marker ?? item.displayTrack[0];
      if (!head) continue;
      drawCap(
        context, geometry, head.latitudeDeg, head.longitudeDeg,
        visibilityAngularRadiusDeg(head.altitudeKm, 5),
        "rgba(255, 205, 120, 0.13)", item.colorTrack,
        variant === "docked" ? 48 : 128,
      );
      const at = project(head.latitudeDeg, head.longitudeDeg, geometry);
      context.fillStyle = item.colorTrack;
      context.beginPath();
      context.arc(at.x, at.y, variant === "expanded" ? 5 : 4, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(6, 12, 20, 0.85)";
      context.lineWidth = 1.5;
      context.stroke();
    }
  }, [drawSeries, geometry, sceneVersion, variant]);

  const pickStation = (clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const longitudeDeg = ((clientX - rect.left) / rect.width) * 360 - 180;
    const latitudeDeg = 90 - ((clientY - rect.top) / rect.height) * 180;
    let best: CoverageStation | null = null;
    let bestSeparation = 12;
    for (const station of stations) {
      const separation = angularSeparationDeg(
        latitudeDeg, longitudeDeg, station.latitudeDeg, station.longitudeDeg,
      );
      if (separation < bestSeparation) { bestSeparation = separation; best = station; }
    }
    if (best) onSelectStation(best.id);
  };

  return (
    <div className={`explorer-coverage explorer-coverage-${variant}`} ref={frameRef}>
      <canvas
        ref={canvasRef}
        className="explorer-coverage-canvas"
        style={{ width: geometry.width, height: geometry.height }}
        onClick={(event) => pickStation(event.clientX, event.clientY)}
      />
      <button
        aria-label={variant === "docked" ? "Expand coverage map" : "Collapse coverage map"}
        className="explorer-coverage-expand"
        title={variant === "docked" ? "Expand" : "Collapse"}
        type="button"
        onClick={onToggleExpanded}
      >
        {variant === "docked" ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
      </button>
    </div>
  );
}

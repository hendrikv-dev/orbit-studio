import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sigma } from "lucide-react";
import { explorerTypeColors } from "../../data/explorerVisuals";
import {
  explorerOrbitTheoryCurves,
  type OrbitTheoryCurve,
} from "../../data/explorerOrbitTheory";
import {
  altitudeToUnit,
  clampPopulationViewport,
  defaultPopulationViewport,
  eccentricityMarkPixels,
  explorerPopulationBounds,
  inclinationToUnit,
  unitToAltitude,
  type ExplorerPopulationPoint,
  type ExplorerPopulationViewport,
} from "../../data/explorerPopulation";

const PADDING = { left: 54, right: 14, top: 14, bottom: 30 };

/**
 * Development-only switch used to compare the chosen semi-major-axis encoding
 * against drawing each object's true perigee→apogee extent. Kept because the
 * comparison is the evidence for the encoding choice and should stay
 * reproducible; it is never reachable in a production build.
 */
function rangeEncodingEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("populationEncoding") === "range"
  );
}
const ALTITUDE_TICKS = [200, 500, 1000, 2000, 5000, 10000, 20000, 35786, 100000, 300000];
const INCLINATION_TICKS = [0, 30, 60, 90, 120, 150, 180];

interface ExplorerPopulationViewProps {
  points: readonly ExplorerPopulationPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  snapshotLabel: string;
  /**
   * Fragments of one break-up, to be picked out of the whole population. The
   * rest of the scatter is dimmed rather than removed so the cloud is read
   * against the population it belongs to.
   */
  highlightIds?: ReadonlySet<string>;
  highlightLabel?: string;
  /** Why this total differs from the catalog total shown elsewhere. */
  countNote?: string | null;
}

interface PlotGeometry {
  width: number;
  height: number;
  plotWidth: number;
  plotHeight: number;
}

export function ExplorerPopulationView({
  points,
  selectedId,
  onSelect,
  snapshotLabel,
  highlightIds,
  highlightLabel,
  countNote,
}: ExplorerPopulationViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<ExplorerPopulationViewport>(defaultPopulationViewport);
  const [geometry, setGeometry] = useState<PlotGeometry>({
    width: 0, height: 0, plotWidth: 0, plotHeight: 0,
  });
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  // Theory overlay: the closed-form curves a student derives, drawn over the
  // measured population so the two can be read together.
  const [showTheory, setShowTheory] = useState(false);
  // Pinning and hovering are separate states. Collapsing them into one meant a
  // click landed on a curve that hover had already made active, so the toggle
  // read "already on" and switched it off — the explanation vanished at the
  // moment you asked for it, and on touch, where there is no hover, it never
  // appeared at all.
  const [pinnedCurveId, setPinnedCurveId] = useState<string | null>(null);
  const [hoveredCurveId, setHoveredCurveId] = useState<string | null>(null);
  const activeCurveId = pinnedCurveId ?? hoveredCurveId;

  const bounds = useMemo(() => explorerPopulationBounds(points), [points]);

  // Points grouped by category so the draw loop sets fillStyle once per colour
  // instead of once per object: at 33k objects that switch alone cost ~30 ms.
  const categoryBuckets = useMemo(() => {
    const buckets = new Map<string, number[]>();
    for (let index = 0; index < points.length; index += 1) {
      const key = points[index].categoryId;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(index);
      else buckets.set(key, [index]);
    }
    return [...buckets.entries()];
  }, [points]);
  const rangeVariant = useMemo(rangeEncodingEnabled, []);

  /**
   * Screen positions are projected once per viewport change into a flat typed
   * array, then shared by drawing, hit testing and the visible count. Projecting
   * per point per pointer event was the difference between a 67 ms and a sub-frame
   * interaction at 33k objects.
   */
  const projection = useMemo(() => {
    const count = points.length;
    const xs = new Float32Array(count);
    const ys = new Float32Array(count);
    const inside = new Uint8Array(count);
    let visible = 0;
    let peak = 0;
    if (geometry.plotWidth > 0) {
      const span = 1 / viewport.zoom;
      const cell = 3;
      const columns = Math.max(1, Math.round(geometry.plotWidth / cell));
      const rows = Math.max(1, Math.round(geometry.plotHeight / cell));
      const counts = new Uint32Array(columns * rows);
      for (let index = 0; index < count; index += 1) {
        const point = points[index];
        const ux = (inclinationToUnit(point.inclinationDeg) - viewport.offsetX) / span;
        const uy = (altitudeToUnit(point.semiMajorAltitudeKm, bounds) - viewport.offsetY) / span;
        xs[index] = PADDING.left + ux * geometry.plotWidth;
        ys[index] = PADDING.top + (1 - uy) * geometry.plotHeight;
        const within = ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1 ? 1 : 0;
        inside[index] = within;
        visible += within;
        if (within) {
          const bin = Math.min(rows - 1, (uy * rows) | 0) * columns + Math.min(columns - 1, (ux * columns) | 0);
          const next = counts[bin] + 1;
          counts[bin] = next;
          if (next > peak) peak = next;
        }
      }
    }
    return { xs, ys, inside, visible, peak };
  }, [bounds, geometry.plotHeight, geometry.plotWidth, points, viewport]);

  const altitudeToY = useCallback(
    (altitudeKm: number) =>
      PADDING.top +
      (1 - (altitudeToUnit(altitudeKm, bounds) - viewport.offsetY) * viewport.zoom) *
        geometry.plotHeight,
    [bounds, geometry.plotHeight, viewport],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setGeometry({
        width: box.width,
        height: box.height,
        plotWidth: Math.max(box.width - PADDING.left - PADDING.right, 10),
        plotHeight: Math.max(box.height - PADDING.top - PADDING.bottom, 10),
      });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const visibleCount = geometry.plotWidth > 0 ? projection.visible : points.length;

  // Static layer: axes + the whole catalog. Re-rendered only when the data,
  // viewport or size changes — never on hover.
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

    context.strokeStyle = "rgba(126, 154, 176, 0.22)";
    context.fillStyle = "#7f95a8";
    context.lineWidth = 1;
    context.font = "10px ui-sans-serif, system-ui, sans-serif";
    context.textBaseline = "middle";

    const span = 1 / viewport.zoom;
    for (const tick of ALTITUDE_TICKS) {
      if (tick < bounds.minAltitudeKm || tick > bounds.maxAltitudeKm) continue;
      const uy = (altitudeToUnit(tick, bounds) - viewport.offsetY) / span;
      if (uy < 0 || uy > 1) continue;
      const y = PADDING.top + (1 - uy) * geometry.plotHeight;
      context.beginPath();
      context.moveTo(PADDING.left, y);
      context.lineTo(PADDING.left + geometry.plotWidth, y);
      context.stroke();
      context.textAlign = "right";
      context.fillText(tick >= 1000 ? `${Math.round(tick / 1000)}k` : String(tick), PADDING.left - 7, y);
    }
    context.textAlign = "center";
    for (const tick of INCLINATION_TICKS) {
      const ux = (inclinationToUnit(tick) - viewport.offsetX) / span;
      if (ux < 0 || ux > 1) continue;
      const x = PADDING.left + ux * geometry.plotWidth;
      context.beginPath();
      context.moveTo(x, PADDING.top);
      context.lineTo(x, PADDING.top + geometry.plotHeight);
      context.stroke();
      context.fillText(`${tick}\u00b0`, x, PADDING.top + geometry.plotHeight + 14);
    }

    // Overplotting is the density representation: alpha accumulates where marks
    // coincide, so shells read as solid lines while sparse regions stay legible.
    // The bin pass only tunes that alpha so a 10k-object shell cannot blow out
    // the rest of the catalog.
    const alpha = Math.min(0.85, Math.max(0.16, 1.6 / Math.log10(Math.max(projection.peak, 2) + 8)));
    const radius = projection.visible > 12000 ? 0.9 : projection.visible > 3000 ? 1.2 : projection.visible > 600 ? 1.8 : 2.6;

    context.save();
    context.beginPath();
    context.rect(PADDING.left, PADDING.top, geometry.plotWidth, geometry.plotHeight);
    context.clip();
    context.globalAlpha = alpha;

    for (const [categoryId, indices] of categoryBuckets) {
      const color = explorerTypeColors[categoryId as keyof typeof explorerTypeColors] ?? "#8fb4cc";
      context.fillStyle = color;
      context.strokeStyle = color;

      for (const index of indices) {
        if (!projection.inside[index]) continue;
        const point = points[index];
        if (point.id === selectedId) continue;
        const x = projection.xs[index];
        const y = projection.ys[index];

        if (rangeVariant) {
          // Validation encoding B: every object's real radial extent. Kept so
          // the comparison behind the chosen encoding stays reproducible.
          context.lineWidth = Math.max(0.6, radius);
          context.beginPath();
          context.moveTo(x, altitudeToY(point.apogeeAltitudeKm));
          context.lineTo(x, altitudeToY(point.perigeeAltitudeKm));
          context.stroke();
          continue;
        }

        const mark = eccentricityMarkPixels(point.eccentricity);
        if (mark > 0 && radius >= 1.2) {
          // Capped whisker: signals that the orbit has extent, never its magnitude.
          context.lineWidth = Math.max(0.7, radius * 0.7);
          context.beginPath();
          context.moveTo(x, y - mark / 2);
          context.lineTo(x, y + mark / 2);
          context.stroke();
        }

        if (radius <= 1.3) {
          // At shell density a square and a circle are the same two pixels.
          const size = radius * 2;
          context.fillRect(x - radius, y - radius, size, size);
        } else {
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
    if (showTheory) {
      // Deliberately a different visual language from the data: thin, dashed and
      // cool, so it reads as "this is the equation" rather than "these are objects".
      context.save();
      context.beginPath();
      context.rect(PADDING.left, PADDING.top, geometry.plotWidth, geometry.plotHeight);
      context.clip();
      context.font = "10px ui-sans-serif, system-ui, sans-serif";
      context.textBaseline = "middle";
      // On a narrow plot every edge is already occupied by a panel, and the
      // legend names each curve anyway, so the on-canvas labels are dropped
      // rather than drawn underneath something.
      const labelCurves = geometry.plotWidth >= 520;

      for (const curve of explorerOrbitTheoryCurves) {
        const active = curve.id === activeCurveId;
        context.strokeStyle = active ? "rgba(167, 243, 208, 0.95)" : "rgba(125, 211, 252, 0.6)";
        context.fillStyle = active ? "rgba(167, 243, 208, 0.95)" : "rgba(125, 211, 252, 0.75)";
        context.lineWidth = active ? 2 : 1.25;
        context.setLineDash(active ? [] : [5, 4]);

        if (curve.kind === "constant-inclination" && curve.inclinationDeg !== undefined) {
          const x = PADDING.left +
            ((inclinationToUnit(curve.inclinationDeg) - viewport.offsetX) * viewport.zoom) *
              geometry.plotWidth;
          context.beginPath();
          context.moveTo(x, PADDING.top);
          context.lineTo(x, PADDING.top + geometry.plotHeight);
          context.stroke();
          if (labelCurves) {
            context.save();
            context.translate(x + 4, PADDING.top + 6);
            context.textAlign = "left";
            context.fillText(curve.label, 0, 0);
            context.restore();
          }
        }

        if (curve.kind === "constant-altitude" && curve.altitudeKm !== undefined) {
          const y = PADDING.top +
            (1 - (altitudeToUnit(curve.altitudeKm, bounds) - viewport.offsetY) * viewport.zoom) *
              geometry.plotHeight;
          context.beginPath();
          context.moveTo(PADDING.left, y);
          context.lineTo(PADDING.left + geometry.plotWidth, y);
          context.stroke();
          if (labelCurves) {
            // Centred: the population legend owns the left of the plot and the
            // theory legend owns the right, at every breakpoint.
            context.textAlign = "center";
            context.fillText(curve.label, PADDING.left + geometry.plotWidth / 2, y - 8);
          }
        }

        if (curve.kind === "inclination-of-altitude" && curve.inclinationAt) {
          // Sampled in altitude because the relationship is inclination(altitude).
          context.beginPath();
          let started = false;
          let labelAt: { x: number; y: number } | null = null;
          const steps = 160;
          for (let step = 0; step <= steps; step += 1) {
            const unit = step / steps;
            const altitudeKm = unitToAltitude(unit, bounds);
            const inclinationDeg = curve.inclinationAt(altitudeKm);
            if (inclinationDeg === null) { started = false; continue; }
            const x = PADDING.left +
              ((inclinationToUnit(inclinationDeg) - viewport.offsetX) * viewport.zoom) *
                geometry.plotWidth;
            const y = PADDING.top +
              (1 - (unit - viewport.offsetY) * viewport.zoom) * geometry.plotHeight;
            if (started) context.lineTo(x, y); else { context.moveTo(x, y); started = true; }
            if (unit > 0.34 && !labelAt) labelAt = { x, y };
          }
          context.stroke();
          if (labelAt && labelCurves) {
            context.textAlign = "left";
            context.fillText(curve.label, labelAt.x + 6, labelAt.y);
          }
        }
      }
      context.setLineDash([]);
      context.restore();
    }

    context.restore();
    setSceneVersion((current) => current + 1);
  }, [activeCurveId, altitudeToY, bounds, categoryBuckets, geometry, points, projection, rangeVariant, selectedId, showTheory, viewport]);

  // Interactive layer: blit the static plot, then draw only selection and hover.
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

    context.save();
    context.beginPath();
    context.rect(PADDING.left, PADDING.top, geometry.plotWidth, geometry.plotHeight);
    context.clip();

    // One break-up's fragments, picked out of the population they are part of.
    // The population is dimmed rather than filtered away: the cloud's shape only
    // means something against the background it sits in.
    if (highlightIds && highlightIds.size > 0) {
      context.fillStyle = "rgba(4, 9, 16, 0.74)";
      context.fillRect(PADDING.left, PADDING.top, geometry.plotWidth, geometry.plotHeight);
      context.fillStyle = "#ffb54a";
      for (let index = 0; index < points.length; index += 1) {
        if (!projection.inside[index] || !highlightIds.has(points[index].id)) continue;
        context.beginPath();
        context.arc(projection.xs[index], projection.ys[index], 1.8, 0, Math.PI * 2);
        context.fill();
      }
    }

    const selectedIndex = selectedId ? points.findIndex((point) => point.id === selectedId) : -1;
    if (selectedIndex >= 0 && projection.inside[selectedIndex]) {
      const point = points[selectedIndex];
      const x = projection.xs[selectedIndex];
      const y = projection.ys[selectedIndex];

      // The true perigee -> apogee extent is drawn only here, for one object.
      context.strokeStyle = "rgba(120, 208, 255, 0.55)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(x, altitudeToY(point.apogeeAltitudeKm));
      context.lineTo(x, altitudeToY(point.perigeeAltitudeKm));
      context.stroke();
      for (const edge of [point.perigeeAltitudeKm, point.apogeeAltitudeKm]) {
        const edgeY = altitudeToY(edge);
        context.beginPath();
        context.moveTo(x - 5, edgeY);
        context.lineTo(x + 5, edgeY);
        context.stroke();
      }

      context.strokeStyle = "rgba(120, 208, 255, 0.32)";
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(PADDING.left, y);
      context.lineTo(x, y);
      context.moveTo(x, PADDING.top + geometry.plotHeight);
      context.lineTo(x, y);
      context.stroke();
      context.setLineDash([]);

      context.fillStyle = "#eaf6ff";
      context.beginPath();
      context.arc(x, y, 4.5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#2bb3ff";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 8, 0, Math.PI * 2);
      context.stroke();
    }

    if (hoveredIndex >= 0 && hoveredIndex < points.length && projection.inside[hoveredIndex] &&
        points[hoveredIndex].id !== selectedId) {
      context.strokeStyle = "rgba(233, 245, 255, 0.85)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(projection.xs[hoveredIndex], projection.ys[hoveredIndex], 6, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }, [altitudeToY, geometry, highlightIds, hoveredIndex, points, projection, sceneVersion, selectedId]);

  // Hit testing reads the same projected arrays the plot was drawn from, so the
  // mark under the cursor is always the object that gets selected.
  const pick = useCallback(
    (clientX: number, clientY: number): number => {
      const frame = frameRef.current;
      if (!frame || geometry.plotWidth <= 0) return -1;
      const rect = frame.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let best = -1;
      let bestDistance = 14 * 14;
      const { xs, ys, inside } = projection;
      for (let index = 0; index < xs.length; index += 1) {
        if (!inside[index]) continue;
        const dx = xs[index] - x;
        const dy = ys[index] - y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) { bestDistance = distance; best = index; }
      }
      return best;
    },
    [geometry.plotWidth, projection],
  );

  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const zoomAt = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      const px = (clientX - rect.left - PADDING.left) / Math.max(geometry.plotWidth, 1);
      const py = 1 - (clientY - rect.top - PADDING.top) / Math.max(geometry.plotHeight, 1);
      setViewport((current) => {
        const next = clampPopulationViewport({ ...current, zoom: current.zoom * factor });
        const anchorX = current.offsetX + px / current.zoom;
        const anchorY = current.offsetY + py / current.zoom;
        return clampPopulationViewport({
          zoom: next.zoom,
          offsetX: anchorX - px / next.zoom,
          offsetY: anchorY - py / next.zoom,
        });
      });
    },
    [geometry.plotHeight, geometry.plotWidth],
  );

  const selectedIsVisible = useMemo(() => {
    if (!selectedId) return true;
    const index = points.findIndex((item) => item.id === selectedId);
    if (index < 0) return true;
    return projection.inside[index] === 1;
  }, [points, projection, selectedId]);

  const readout =
    (hoveredIndex >= 0 ? points[hoveredIndex] : null) ??
    points.find((point) => point.id === selectedId) ??
    null;

  return (
    <div className="explorer-population" ref={frameRef}>
      <canvas
        ref={canvasRef}
        className="explorer-population-canvas"
        style={{ width: geometry.width, height: geometry.height }}
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag) {
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
            drag.moved = true;
            drag.x = event.clientX;
            drag.y = event.clientY;
            setViewport((current) =>
              clampPopulationViewport({
                zoom: current.zoom,
                offsetX: current.offsetX - dx / (Math.max(geometry.plotWidth, 1) * current.zoom),
                offsetY: current.offsetY + dy / (Math.max(geometry.plotHeight, 1) * current.zoom),
              }),
            );
            return;
          }
          setHoveredIndex(pick(event.clientX, event.clientY));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (drag && !drag.moved) {
            const index = pick(event.clientX, event.clientY);
            if (index >= 0) onSelect(points[index].id);
          }
        }}
        onPointerLeave={() => setHoveredIndex(-1)}
        onWheel={(event) => {
          event.preventDefault();
          zoomAt(event.deltaY < 0 ? 1.18 : 1 / 1.18, event.clientX, event.clientY);
        }}
      />

      <div className="explorer-population-axis-labels" aria-hidden="true">
        <span className="explorer-population-axis-y">Semi-major-axis altitude (km)</span>
        <span className="explorer-population-axis-x">Inclination</span>
      </div>

      <div className="explorer-population-legend">
        <strong>Current orbital population</strong>
        <span>
          {visibleCount.toLocaleString()} of {points.length.toLocaleString()} plotted · {snapshotLabel}
        </span>
        <span className="explorer-population-note">
          Sourced orbit shape only. Positions along each orbit are not shown.
        </span>
        {countNote ? (
          <span className="explorer-population-note">{countNote}</span>
        ) : null}
      </div>

      {readout && (
        <div className="explorer-population-readout" role="status">
          <strong>{readout.name}</strong>
          <dl>
            <div><dt>a − R⊕</dt><dd>{Math.round(readout.semiMajorAltitudeKm).toLocaleString()} km</dd></div>
            <div><dt>Perigee</dt><dd>{Math.round(readout.perigeeAltitudeKm).toLocaleString()} km</dd></div>
            <div><dt>Apogee</dt><dd>{Math.round(readout.apogeeAltitudeKm).toLocaleString()} km</dd></div>
            <div><dt>Inclination</dt><dd>{readout.inclinationDeg.toFixed(1)}°</dd></div>
            <div><dt>Eccentricity</dt><dd>{readout.eccentricity.toFixed(4)}</dd></div>
          </dl>
        </div>
      )}

      <div className="explorer-population-theory">
        <button
          aria-pressed={showTheory}
          className={showTheory ? "active" : ""}
          type="button"
          onClick={() => setShowTheory((current) => {
            if (current) { setPinnedCurveId(null); setHoveredCurveId(null); }
            return !current;
          })}
        >
          <Sigma aria-hidden="true" size={14} />
          <span>Orbit theory</span>
        </button>
        {showTheory && (
          <ul>
            {explorerOrbitTheoryCurves.map((curve: OrbitTheoryCurve) => (
              <li key={curve.id}>
                <button
                  aria-pressed={curve.id === pinnedCurveId}
                  className={curve.id === activeCurveId ? "active" : ""}
                  type="button"
                  onMouseEnter={() => setHoveredCurveId(curve.id)}
                  onFocus={() => setHoveredCurveId(curve.id)}
                  onMouseLeave={() => setHoveredCurveId(null)}
                  onBlur={() => setHoveredCurveId(null)}
                  onClick={() =>
                    setPinnedCurveId((current) => current === curve.id ? null : curve.id)}
                >
                  {curve.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {showTheory && activeCurveId && (
          <p>{explorerOrbitTheoryCurves.find((c) => c.id === activeCurveId)?.explanation}</p>
        )}
      </div>

      <div className="explorer-population-controls">
        {viewport.zoom > 1.01 && (
          <button type="button" onClick={() => setViewport(defaultPopulationViewport)}>
            Reset view
          </button>
        )}
        {!selectedIsVisible && (
          <button
            type="button"
            onClick={() => {
              const point = points.find((item) => item.id === selectedId);
              if (!point) return;
              const span = 1 / viewport.zoom;
              setViewport((current) =>
                clampPopulationViewport({
                  zoom: current.zoom,
                  offsetX: inclinationToUnit(point.inclinationDeg) - span / 2,
                  offsetY: altitudeToUnit(point.semiMajorAltitudeKm, bounds) - span / 2,
                }),
              );
            }}
          >
            Show selected
          </button>
        )}
      </div>

      {points.length === 0 && (
        <p className="explorer-population-empty">
          No objects with sourced orbit shape match the current filters.
        </p>
      )}
    </div>
  );
}

export function populationAltitudeAtUnit(unit: number, min: number, max: number): number {
  return unitToAltitude(unit, { minAltitudeKm: min, maxAltitudeKm: max });
}

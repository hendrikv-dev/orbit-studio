import {
  longitudeDriftPerRevolutionDeg,
  revolutionsPerDay,
  type CoverageEnvelope,
  type CoverageStation,
  type OrbitShape,
  type StationAccessEstimate,
} from "../../data/explorerCoverage";

/**
 * The numbers the map is a picture of: how much of the Earth falls inside the
 * coverage band, how fast the track walks west, and which ground stations ever
 * see the object.
 *
 * Shared by the docked panel and the promoted surface. A whole-world map is
 * only correct at 2:1, so promoting it on a tall screen leaves real slack
 * around it — this is what belongs there, rather than empty background.
 */
export function ExplorerCoverageReadout({
  access,
  envelope,
  shape,
  stations,
}: {
  access: readonly StationAccessEstimate[];
  envelope: CoverageEnvelope;
  shape: OrbitShape;
  stations: readonly CoverageStation[];
}) {
  return (
    <>
      {/* Period and inclination are shown above the map in the inspector; only
          what the map itself adds appears here. */}
      <dl>
        <div>
          <dt>Coverage band</dt>
          <dd>±{envelope.coveredLimitDeg.toFixed(1)}°</dd>
        </div>
        <div>
          <dt>Earth surface in band</dt>
          <dd>{(envelope.surfaceFraction * 100).toFixed(0)}%</dd>
        </div>
        <div>
          <dt>Revolutions / day</dt>
          <dd>{revolutionsPerDay(shape.semiMajorAltitudeKm).toFixed(2)}</dd>
        </div>
        <div>
          <dt>Track shift / rev</dt>
          <dd>{longitudeDriftPerRevolutionDeg(shape.semiMajorAltitudeKm).toFixed(1)}°</dd>
        </div>
      </dl>
      {stations.length > 0 && (
        <ul className="explorer-coverage-stations">
          {access.map((item) => (
            <li key={item.stationId} className={item.reachable ? "reachable" : ""}>
              <span>
                {stations.find((station) => station.id === item.stationId)?.name ?? item.stationId}
              </span>
              <span>
                {item.reachable
                  ? `~${Math.round(item.accessesPerDay)} passes/day`
                  : "never in view"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The provenance note, kept next to the numbers wherever they appear. */
export function ExplorerCoverageCaveat() {
  return (
    <p className="explorer-coverage-caveat">
      Coverage band, footprint and pass rates come from the sourced orbit shape. The
      track&apos;s longitude comes from a reconstructed phase, so it shows the shape and
      spacing of the ground track, not a live position — individual pass times are not
      implied.
    </p>
  );
}

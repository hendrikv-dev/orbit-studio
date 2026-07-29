import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { computeGroundContact } from "../physics/coverage";
import { ecefToEci, geodeticToEcef } from "../physics/coordinates";
import type { GroundStationModel, SatelliteModel } from "../lib/scenario";
import { propagateSatellite } from "../lib/propagation";
import { eciToThreeVector } from "./coordinates";

interface ContactLineProps {
  satellite?: SatelliteModel;
  station?: GroundStationModel;
  simulationTime: string;
}

export function ContactLine({ satellite, station, simulationTime }: ContactLineProps) {
  const result = useMemo(() => {
    if (!satellite || !station) {
      return null;
    }

    try {
      const date = new Date(simulationTime);
      const state = propagateSatellite(satellite, date);
      const contact = computeGroundContact(state, station, date);
      const stationEcef = geodeticToEcef({
        latitudeDeg: station.latitudeDeg,
        longitudeDeg: station.longitudeDeg,
        altitudeKm: station.altitudeMeters / 1000,
      });
      return {
        contact,
        points: [eciToThreeVector(ecefToEci(stationEcef, date)), eciToThreeVector(state.positionKm)],
      };
    } catch {
      return null;
    }
  }, [satellite, station, simulationTime]);

  if (!result) {
    return null;
  }

  return (
    <Line
      points={result.points}
      color={result.contact.inContact ? "#86efac" : "#64748b"}
      lineWidth={result.contact.inContact ? 1.45 : 0.85}
      transparent
      opacity={result.contact.inContact ? 0.88 : 0.34}
    />
  );
}

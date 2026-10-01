import type { MapPin } from "./mapNavigation";
import type { ConfirmedPlaceRecord } from "./trackerPersistence";

/** A name is presentation metadata. It must never replace the selected pin. */
export function placeAtPin(pin: MapPin | null, named: ConfirmedPlaceRecord | null): ConfirmedPlaceRecord | null {
  if (!pin) return null;
  const sameNamedPlace = named &&
    Math.abs(named.latitude - pin.latitudeDeg) < 0.01 &&
    Math.abs(named.longitude - pin.longitudeDeg) < 0.01;
  return {
    ...(sameNamedPlace ? named : {
      name: `${pin.latitudeDeg.toFixed(2)}° ${pin.latitudeDeg >= 0 ? "N" : "S"} ${Math.abs(pin.longitudeDeg).toFixed(2)}° ${pin.longitudeDeg >= 0 ? "E" : "W"}`,
      context: "Picked on the map",
      fromDevice: false,
    }),
    latitude: pin.latitudeDeg,
    longitude: pin.longitudeDeg,
    // A moved pin is no longer a device fix, even when its name still fits.
    fromDevice: Boolean(named?.fromDevice && named.latitude === pin.latitudeDeg && named.longitude === pin.longitudeDeg),
  };
}

/** In-memory identity; service-level grid/tile caches may still share source data. */
export function trackerObserverKey(place: { latitude: number; longitude: number } | null): string | null {
  return place ? `${place.latitude},${place.longitude}` : null;
}

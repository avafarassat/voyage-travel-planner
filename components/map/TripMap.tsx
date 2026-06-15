"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  InfoWindow,
  Marker,
} from "@react-google-maps/api";
import { MapLegend } from "@/components/map/map-legend";
import { MUTED_MAP_STYLES } from "@/lib/map/map-styles";
import { fitMapToContent } from "@/lib/map/fit-bounds";
import { createHotelPinIcon, createPlacePinIcon } from "@/lib/map/pin-icons";
import type { Hotel, Place } from "@/lib/types";
import { getCategoryStyle } from "@/lib/types";
import { formatPlaceReservation, placeHasReservation } from "@/lib/utils";

const mapContainerStyle = { width: "100%", height: "100%" };

interface TripMapProps {
  hotel: Hotel | null;
  places: Place[];
  destinationCenter?: { lat: number; lng: number } | null;
  selectedPlaceId?: string | null;
  onSelectPlace?: (placeId: string | null) => void;
  onDeletePlace?: (placeId: string) => void;
  readOnly?: boolean;
}

export function TripMap({
  hotel,
  places,
  destinationCenter = null,
  selectedPlaceId,
  onSelectPlace,
  onDeletePlace,
  readOnly = false,
}: TripMapProps) {
  const [activeInfo, setActiveInfo] = useState<string | null>(null);
  const [zoom, setZoom] = useState(13);
  const mapRef = useRef<google.maps.Map | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const missingKey = !apiKey || apiKey === "your-google-maps-api-key";

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: missingKey ? "" : apiKey,
  });

  const center = useMemo(() => {
    if (hotel) return { lat: hotel.lat, lng: hotel.lng };
    if (places.length > 0) return { lat: places[0].lat, lng: places[0].lng };
    if (destinationCenter) return destinationCenter;
    return { lat: 41.3874, lng: 2.1686 };
  }, [hotel, places, destinationCenter]);

  const hotelIcon = useMemo(
    () => (isLoaded ? createHotelPinIcon(zoom) : undefined),
    [zoom, isLoaded]
  );

  const fitMapToContentCallback = useCallback(
    (map: google.maps.Map) => {
      fitMapToContent(map, hotel, places, 48, destinationCenter);
    },
    [hotel, places, destinationCenter]
  );

  const onLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      fitMapToContentCallback(map);
    },
    [fitMapToContentCallback]
  );

  useEffect(() => {
    if (mapRef.current) {
      fitMapToContentCallback(mapRef.current);
    }
  }, [fitMapToContentCallback]);

  useEffect(() => {
    if (!selectedPlaceId) {
      setActiveInfo(null);
      return;
    }
    const place = places.find((p) => p.id === selectedPlaceId);
    if (!place) return;
    setActiveInfo(selectedPlaceId);
    mapRef.current?.panTo({ lat: place.lat, lng: place.lng });
  }, [selectedPlaceId, places]);

  const onZoomChanged = useCallback(() => {
    const z = mapRef.current?.getZoom();
    if (z != null && Number.isFinite(z)) setZoom(z);
  }, []);

  if (missingKey) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-muted p-6 text-center text-muted-foreground">
        <p className="font-medium text-foreground">Google Maps API key needed</p>
        <p className="max-w-sm text-sm">
          Add your key to <code className="text-xs">.env.local</code> as{" "}
          <code className="text-xs">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>, then restart{" "}
          <code className="text-xs">npm run dev</code>.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-muted p-6 text-center text-muted-foreground">
        <p className="font-medium text-destructive">Map failed to load</p>
        <p className="max-w-sm text-sm">{loadError.message}</p>
        <p className="max-w-sm text-xs">
          Check that Maps JavaScript API is enabled and billing is set up in Google Cloud.
        </p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-muted text-muted-foreground">
        Loading map...
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={13}
        onLoad={onLoad}
        onZoomChanged={onZoomChanged}
        options={{
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          styles: MUTED_MAP_STYLES,
        }}
      >
        {hotel && (
          <>
            <Marker
              position={{ lat: hotel.lat, lng: hotel.lng }}
              icon={hotelIcon}
              zIndex={1000}
              onClick={() => setActiveInfo("hotel")}
            />
            {activeInfo === "hotel" && (
              <InfoWindow
                position={{ lat: hotel.lat, lng: hotel.lng }}
                onCloseClick={() => setActiveInfo(null)}
              >
                <div className="max-w-[200px] p-1">
                  <p className="font-semibold">{hotel.name}</p>
                  <p className="text-xs text-gray-600">Home base</p>
                  <p className="mt-1 text-xs">{hotel.address}</p>
                </div>
              </InfoWindow>
            )}
          </>
        )}

        {places.map((place) => {
          if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return null;
          const style = getCategoryStyle(place.category);
          const isSelected = selectedPlaceId === place.id;
          return (
            <Marker
              key={place.id}
              position={{ lat: place.lat, lng: place.lng }}
              icon={createPlacePinIcon(style.color, place.category, zoom)}
              opacity={isSelected ? 1 : selectedPlaceId ? 0.55 : 0.9}
              zIndex={isSelected ? 1000 : 1}
              onClick={() => {
                setActiveInfo(place.id);
                onSelectPlace?.(place.id);
              }}
            />
          );
        })}

        {places.map(
          (place) =>
            activeInfo === place.id && (
              <InfoWindow
                key={`info-${place.id}`}
                position={{ lat: place.lat, lng: place.lng }}
                onCloseClick={() => {
                  setActiveInfo(null);
                  onSelectPlace?.(null);
                }}
              >
                <div className="max-w-[200px] p-1">
                  <p className="font-semibold">{place.name}</p>
                  <p className="text-xs capitalize text-gray-600">{place.category}</p>
                  {place.address && <p className="mt-1 text-xs">{place.address}</p>}
                  {(place.notes || placeHasReservation(place)) && (
                    <div className="mt-1 space-y-0.5 text-xs text-gray-600">
                      {placeHasReservation(place) && (
                        <p className="font-medium text-indigo-700">
                          {formatPlaceReservation(place)}
                        </p>
                      )}
                      {place.notes && <p className="italic">{place.notes}</p>}
                    </div>
                  )}
                  {!readOnly && onDeletePlace && (
                    <button
                      className="mt-2 text-xs text-red-600 hover:underline"
                      onClick={() => {
                        onDeletePlace(place.id);
                        setActiveInfo(null);
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </InfoWindow>
            )
        )}
      </GoogleMap>
      </div>
      <MapLegend hasHotel={!!hotel} />
    </div>
  );
}

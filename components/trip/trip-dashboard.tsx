"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plane,
  Car,
  Hotel as HotelIcon,
  MapPin,
  Calendar,
  Compass,
  Share2,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { AppHeader } from "@/components/layout/app-header";
import { TripMap } from "@/components/map/TripMap";
import { HotelSection } from "@/components/trip/hotel-section";
import { PlacesSection } from "@/components/trip/places-section";
import { FlightsSection } from "@/components/trip/flights-section";
import { TransportSection } from "@/components/trip/transport-section";
import { DiscoverSection } from "@/components/trip/discover-section";
import { ItinerarySection } from "@/components/trip/itinerary-section";
import { ShareSection } from "@/components/trip/share-section";
import { TripDatesDialog } from "@/components/trip/trip-dates-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, cn, isManualPlace } from "@/lib/utils";
import type {
  Trip,
  Hotel,
  Place,
  Flight,
  TransportBooking,
  ItineraryDay,
  ItineraryStop,
} from "@/lib/types";

interface TripDashboardProps {
  trip: Trip;
  hotel: Hotel | null;
  places: Place[];
  flights: Flight[];
  transport: TransportBooking[];
  itineraryDays: ItineraryDay[];
  itineraryStops: (ItineraryStop & { place?: Place })[];
  readOnly?: boolean;
}

export function TripDashboard({
  trip,
  hotel,
  places,
  flights,
  transport,
  itineraryDays,
  itineraryStops,
  readOnly = false,
}: TripDashboardProps) {
  const router = useRouter();
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("map");
  const [hotelExploreActive, setHotelExploreActive] = useState(false);

  const manualPlaces = useMemo(
    () => places.filter(isManualPlace),
    [places]
  );

  const destinationCenter = useMemo(() => {
    if (
      trip.destination_lat != null &&
      trip.destination_lng != null &&
      Number.isFinite(trip.destination_lat) &&
      Number.isFinite(trip.destination_lng)
    ) {
      return { lat: trip.destination_lat, lng: trip.destination_lng };
    }
    return null;
  }, [trip.destination_lat, trip.destination_lng]);

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const isPlanTab = activeTab === "itinerary";
  const isMapTab = activeTab === "map";
  const isPlacesTab = activeTab === "places";
  const showSideMap =
    !isPlanTab && !isMapTab && !isPlacesTab && !(activeTab === "hotel" && hotelExploreActive);

  const handleDeletePlace = useCallback(
    async (id: string) => {
      if (readOnly) return;
      const { createClient } = await import("@/lib/supabase/client");
      await createClient().from("places").delete().eq("id", id);
      if (selectedPlaceId === id) setSelectedPlaceId(null);
      refresh();
    },
    [readOnly, refresh, selectedPlaceId]
  );

  const myMapPanel = (
    <TripMap
      hotel={hotel}
      places={manualPlaces}
      destinationCenter={destinationCenter}
      selectedPlaceId={selectedPlaceId}
      onSelectPlace={setSelectedPlaceId}
      onDeletePlace={readOnly ? undefined : handleDeletePlace}
      readOnly={readOnly}
    />
  );

  const planMapPanel = useCallback(
    (mapPlaces: Place[]) => (
      <TripMap
        hotel={hotel}
        places={mapPlaces}
        destinationCenter={destinationCenter}
        selectedPlaceId={selectedPlaceId}
        onSelectPlace={setSelectedPlaceId}
        readOnly={readOnly}
      />
    ),
    [hotel, destinationCenter, selectedPlaceId, readOnly]
  );

  const placesSidebar = (
    <PlacesSection
      tripId={trip.id}
      tripStartDate={trip.start_date}
      tripEndDate={trip.end_date}
      places={manualPlaces}
      city={trip.city}
      country={trip.country}
      onUpdate={refresh}
      onSelectPlace={setSelectedPlaceId}
      selectedPlaceId={selectedPlaceId}
      readOnly={readOnly}
      compact
    />
  );

  const mobilePlacesPanel = (
    <PlacesSection
      tripId={trip.id}
      tripStartDate={trip.start_date}
      tripEndDate={trip.end_date}
      places={manualPlaces}
      city={trip.city}
      country={trip.country}
      onUpdate={refresh}
      onSelectPlace={(id) => {
        setSelectedPlaceId(id);
        setActiveTab("map");
      }}
      selectedPlaceId={selectedPlaceId}
      readOnly={readOnly}
    />
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {!readOnly && <AppHeader />}

      <div className="border-b bg-card px-4 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-4">
          {!readOnly && (
            <Link href="/trips" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )}
          <div className="flex-1">
            <h1 className="text-xl font-bold">{trip.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {trip.city}
                {trip.country ? `, ${trip.country}` : ""} · {formatDate(trip.start_date)} –{" "}
                {formatDate(trip.end_date)}
              </p>
              {!readOnly && <TripDatesDialog trip={trip} onUpdated={refresh} />}
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl flex-1 flex-col",
          showSideMap && "lg:flex-row"
        )}
      >
        <div
          className={cn(
            "order-2 flex flex-1 flex-col lg:order-1",
            isPlanTab ? "lg:w-full" : !isMapTab && "lg:min-h-[calc(100vh-8rem)]"
          )}
        >
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className={cn("h-full", isMapTab && "flex flex-col")}
          >
            <div className="sticky top-0 z-30 shrink-0 border-b bg-card px-4 py-2 lg:static">
              <TabsList className="flex h-10 w-full flex-nowrap justify-start gap-1 overflow-x-auto bg-transparent p-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <TabsTrigger
                  value="map"
                  className="shrink-0 gap-1 text-xs data-[state=active]:bg-muted sm:text-sm"
                >
                  <MapPin className="hidden h-3 w-3 sm:block" />
                  My Map
                </TabsTrigger>
                <TabsTrigger
                  value="places"
                  className="shrink-0 gap-1 text-xs sm:text-sm lg:hidden"
                >
                  <MapPin className="hidden h-3 w-3 sm:block" />
                  My Places
                </TabsTrigger>
                <TabsTrigger value="itinerary" className="shrink-0 gap-1 text-xs sm:text-sm">
                  <Calendar className="hidden h-3 w-3 sm:block" />
                  Plan
                </TabsTrigger>
                <TabsTrigger value="flights" className="shrink-0 gap-1 text-xs sm:text-sm">
                  <Plane className="hidden h-3 w-3 sm:block" />
                  Flights
                </TabsTrigger>
                <TabsTrigger value="transport" className="shrink-0 gap-1 text-xs sm:text-sm">
                  <Car className="hidden h-3 w-3 sm:block" />
                  Transport
                </TabsTrigger>
                <TabsTrigger value="hotel" className="shrink-0 gap-1 text-xs sm:text-sm">
                  <HotelIcon className="hidden h-3 w-3 sm:block" />
                  Hotel
                </TabsTrigger>
                {!readOnly && (
                  <>
                    <TabsTrigger value="discover" className="shrink-0 gap-1 text-xs sm:text-sm">
                      <Compass className="hidden h-3 w-3 sm:block" />
                      Discover
                    </TabsTrigger>
                    <TabsTrigger value="share" className="shrink-0 gap-1 text-xs sm:text-sm">
                      <Share2 className="hidden h-3 w-3 sm:block" />
                      Share
                    </TabsTrigger>
                  </>
                )}
              </TabsList>
            </div>

            <TabsContent
              value="map"
              className="mt-0 min-h-0 flex-1 focus-visible:outline-none data-[state=inactive]:hidden"
            >
              <div className="flex h-[calc(100vh-9.5rem)] flex-col lg:h-[calc(100vh-10rem)] lg:flex-row">
                <div className="hidden overflow-y-auto border-r p-3 lg:block lg:w-72 lg:shrink-0 xl:w-80">
                  {placesSidebar}
                </div>
                <div className="min-h-0 flex-1">{myMapPanel}</div>
              </div>
            </TabsContent>

            <TabsContent
              value="places"
              className="mt-0 max-h-[60vh] overflow-y-auto p-4 focus-visible:outline-none data-[state=inactive]:hidden lg:hidden"
            >
              {mobilePlacesPanel}
            </TabsContent>

            {!isMapTab && !isPlacesTab && (
              <div className="max-h-[60vh] overflow-x-visible overflow-y-auto p-4 lg:max-h-none">
                <TabsContent value="itinerary" className="mt-0">
                  <ItinerarySection
                    trip={trip}
                    hotel={hotel}
                    places={places}
                    days={itineraryDays}
                    stops={itineraryStops}
                    onUpdate={refresh}
                    readOnly={readOnly}
                    wideLayout
                    renderMap={planMapPanel}
                  />
                </TabsContent>

                <TabsContent value="flights" className="mt-0">
                  <FlightsSection
                    tripId={trip.id}
                    flights={flights}
                    onUpdate={refresh}
                    readOnly={readOnly}
                  />
                </TabsContent>

                <TabsContent value="transport" className="mt-0">
                  <TransportSection
                    tripId={trip.id}
                    bookings={transport}
                    onUpdate={refresh}
                    readOnly={readOnly}
                  />
                </TabsContent>

                <TabsContent value="hotel" className="mt-0">
                  <HotelSection
                    tripId={trip.id}
                    hotel={hotel}
                    city={trip.city}
                    country={trip.country}
                    tripStartDate={trip.start_date}
                    tripEndDate={trip.end_date}
                    onUpdate={refresh}
                    onExploreActiveChange={setHotelExploreActive}
                    readOnly={readOnly}
                  />
                </TabsContent>

                {!readOnly && (
                  <>
                    <TabsContent value="discover" className="mt-0">
                      <DiscoverSection tripId={trip.id} hotel={hotel} onUpdate={refresh} />
                    </TabsContent>
                    <TabsContent value="share" className="mt-0">
                      <ShareSection trip={trip} onUpdate={refresh} />
                    </TabsContent>
                  </>
                )}
              </div>
            )}
          </Tabs>
        </div>

        {showSideMap && (
          <div className="order-1 hidden h-[calc(100vh-8rem)] flex-1 border-l lg:order-2 lg:block lg:max-w-[55%]">
            {myMapPanel}
          </div>
        )}
      </div>
    </div>
  );
}

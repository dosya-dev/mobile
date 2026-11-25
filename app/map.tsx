import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Icon } from "@/ui/Icon";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { API_BASE_URL } from "@/api/config";
import { getMapPins, hasBasemap, type MapPin } from "@/map/api";
import { MAP_HTML } from "@/map/mapHtml.generated";
import { useT } from "@/lib/i18n";
import { byteCount } from "@/lib/format-locale";

/**
 * Where the photos were taken.
 *
 * MapLibre runs inside a WebView with the whole library inlined into one HTML
 * string, the same trick the book reader uses for foliate-js. That is what makes
 * this buildable with no new native dependency, and therefore testable without
 * an EAS rebuild - react-native-maps would need a native module, a config-plugin
 * change and a Google Maps key.
 *
 * React Native owns the data and the navigation; the page owns only the drawing.
 * Pins are fetched here because /api/map/pins is authenticated and the WebView
 * has no token - and giving it one would put a credential inside a web page for
 * the sake of a thumbnail.
 *
 * Pins are therefore plain markers rather than photo thumbnails, and the basemap
 * carries no place labels: the glyph fonts web serves from its own /public have
 * nowhere to be served from here. Both are additive later.
 *
 * Only what the map plots crosses into the page: an `[id, lon, lat, kind]`
 * tuple per pin. /api/map/pins answers with whole file rows (name, mime,
 * uploader, share and comment counts), which is 927KB at 2000 pins - and every
 * byte of it would be stringified here and re-parsed inside the WebView for the
 * sake of four fields. `slim` asks the API for just those four.
 */
export default function MapScreen() {
  const t = useT();
  const router = useRouter();
  const { scheme, tokens } = useColorTheme();
  const workspaces = useWorkspaces();
  const ws = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const webRef = useRef<WebView>(null);

  const [pageReady, setPageReady] = useState(false);
  const [pageLoaded, setPageLoaded] = useState(false);
  const initedRef = useRef(false);
  const dark = scheme === "dark";

  const pinsQ = useQuery({
    queryKey: ["map-pins", ws],
    enabled: !!ws,
    queryFn: () => getMapPins(ws as string),
    // Locations only change when something is uploaded or the scanner catches
    // up. Refetching a library-sized pin list every time this screen regains
    // focus costs a lot and moves nothing on the map.
    staleTime: 5 * 60_000,
  });

  const basemapQ = useQuery({
    queryKey: ["map-basemap"],
    queryFn: hasBasemap,
    staleTime: 5 * 60_000,
  });

  const pins: MapPin[] = useMemo(() => pinsQ.data?.pins ?? [], [pinsQ.data]);

  const inject = useCallback((js: string) => {
    webRef.current?.injectJavaScript(`${js}; true;`);
  }, []);

  /**
   * Initialise once the page has loaded AND the basemap probe has settled.
   *
   * Both conditions, because initMap chooses the style once and keeps it. Firing
   * on load alone races the probe: when the page won, the map was told there was
   * no basemap and rendered tile-less for the rest of the screen's life even
   * though the tiles existed.
   */
  useEffect(() => {
    if (initedRef.current || !pageLoaded || !basemapQ.isFetched) return;
    initedRef.current = true;
    inject(
      `window.initMap(${JSON.stringify({
        dark,
        hasBasemap: basemapQ.data === true,
        apiBase: API_BASE_URL,
      })})`,
    );
  }, [pageLoaded, basemapQ.isFetched, basemapQ.data, dark, inject]);

  /**
   * The pins, as the compact tuples the page draws from.
   *
   * `JSON.parse` of a string literal rather than a JavaScript object literal:
   * injectJavaScript hands the WebView source text to compile, and a parser
   * that already knows it is reading JSON is markedly quicker at it than the
   * full JavaScript grammar - which is the whole cost at library scale.
   */
  const wire = useMemo(
    () =>
      JSON.stringify(
        JSON.stringify(
          pins.map((p) => [p.id, p.longitude, p.latitude, p.kind === "folder" ? "d" : "f"]),
        ),
      ),
    [pins],
  );

  /**
   * Frame the pins once per workspace, not on every delivery.
   *
   * Re-fitting whenever the query returns would drag someone who had panned to
   * a city back out to the whole library the moment a refetch landed.
   */
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pageReady) return;
    const shouldFit = pins.length > 0 && fittedFor.current !== ws;
    if (shouldFit) fittedFor.current = ws;
    inject(`window.setPins(JSON.parse(${wire}), ${shouldFit})`);
  }, [pageReady, wire, pins.length, ws, inject]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: { type?: string; id?: string; kind?: string };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === "ready") setPageReady(true);
      // Navigation belongs to the app shell, not to a page inside a WebView.
      // A folder pin is a folder: sending its id to /file would open a viewer
      // for something that has no bytes.
      if (msg.type === "open" && msg.id) {
        router.push(msg.kind === "folder" ? `/folder/${msg.id}` : `/file/${msg.id}`);
      }
    },
    [router],
  );

  const failed = pinsQ.isError || !ws;
  const empty = !pinsQ.isLoading && !failed && pins.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("map.heading.map") }} />

      {failed ? (
        <View className="mt-16 items-center px-8" testID="map-error">
          <Icon name="cloud-offline-outline" size={26} color={tokens.mutedForeground} />
          <Text className="mt-2 text-center text-sm text-muted-foreground">
            {t("map.error.couldnTLoadYourMap")}
          </Text>
          <Pressable
            testID="map-retry"
            accessibilityRole="button"
            onPress={() => void pinsQ.refetch()}
            className="mt-3 rounded-lg border border-border px-3 py-1.5"
          >
            <Text className="text-xs text-foreground">{t("common.retry")}</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1">
          <WebView
            ref={webRef}
            testID="map-webview"
            source={{ html: MAP_HTML, baseUrl: API_BASE_URL }}
            originWhitelist={["*"]}
            onLoadEnd={() => setPageLoaded(true)}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            // The page is a fixed local string; nothing in it should navigate.
            setSupportMultipleWindows={false}
            style={{ flex: 1, backgroundColor: dark ? "#0f1720" : "#e7ebef" }}
          />

          {pinsQ.isLoading ? (
            <View className="absolute inset-0 items-center justify-center" testID="map-loading">
              <ActivityIndicator color={tokens.primary} />
            </View>
          ) : null}

          {empty ? (
            <View className="absolute inset-0 items-center justify-center px-10" testID="map-empty">
              <Icon name="location-outline" size={30} color={tokens.mutedForeground} />
              <Text className="mt-2 text-center text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
                {t("map.empty.noGeotaggedPhotosYet")}
              </Text>
              <Text className="mt-1 text-center text-xs text-muted-foreground">
                {t("map.description.photosTakenOnAPhoneUsuallyCarryGPSCoordinatesBackThemUpAndThey")}
              </Text>
            </View>
          ) : null}

          {!empty && pins.length > 0 ? (
            <View className="absolute start-4 top-4 rounded-full bg-card px-2.5 py-1" testID="map-count">
              <Text className="text-xs text-foreground">
                {t("map.label.gpsLocated", { gps: byteCount(pins.length) })}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

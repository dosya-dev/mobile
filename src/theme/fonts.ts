// Space Grotesk (body/UI) + Space Mono (wordmark) - the exact families the web app
// uses. Loaded in app/_layout.tsx via useFonts. RN needs the explicit per-weight
// family name (it won't synthesise weights from a single-weight face), so map each.
export const fonts = {
  regular: "SpaceGrotesk_400Regular",
  medium: "SpaceGrotesk_500Medium",
  bold: "SpaceGrotesk_700Bold",
  mono: "SpaceMono_400Regular",
} as const;

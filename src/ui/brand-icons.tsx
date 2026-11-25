import { SvgXml } from "react-native-svg";
import { useColorTheme } from "@/theme/useColorTheme";
import { dosyaLogoSvg } from "./brandLogoSvg";

/**
 * The dosya folder mark, from the same geometry every other surface renders
 * (scripts/lib/brand-mark.mjs, via scripts/gen-brand-assets.mjs). The outline is
 * `currentColor`, so `color` defaults to the theme's foreground and can be
 * overridden for a lockup on a plate; the green seal is baked in per scheme.
 */
export function DosyaLogo({ size = 28, color }: { size?: number; color?: string }) {
  const { scheme, tokens } = useColorTheme();
  return <SvgXml xml={dosyaLogoSvg(scheme)} width={size} height={size} color={color ?? tokens.foreground} />;
}

// The 4-colour Google "G" - identical paths to the web login button.
const GOOGLE_G = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
<path d="M8 6.54541V9.6436H12.3054C12.1164 10.64 11.549 11.4836 10.6981 12.0509L13.2945 14.0655C14.8072 12.6691 15.68 10.6182 15.68 8.18185C15.68 7.61459 15.6291 7.06908 15.5345 6.5455L8 6.54541Z" fill="#4285F4"/>
<path d="M3.51576 9.52246L2.93018 9.97071L0.857422 11.5852C2.17378 14.1961 4.87176 15.9998 7.99901 15.9998C10.159 15.9998 11.9698 15.287 13.2935 14.0653L10.6972 12.0507C9.98443 12.5307 9.07533 12.8216 7.99901 12.8216C5.91902 12.8216 4.1518 11.418 3.51903 9.52708L3.51576 9.52246Z" fill="#34A853"/>
<path d="M0.858119 4.41455C0.312695 5.49087 0 6.70543 0 7.99996C0 9.29448 0.312695 10.509 0.858119 11.5854C0.858119 11.5926 3.51998 9.51991 3.51998 9.51991C3.35998 9.03991 3.26541 8.53085 3.26541 7.99987C3.26541 7.46889 3.35998 6.95984 3.51998 6.47984L0.858119 4.41455Z" fill="#FBBC05"/>
<path d="M7.99918 3.18545C9.17737 3.18545 10.2246 3.59271 11.061 4.37818L13.3519 2.0873C11.9628 0.792777 10.1592 0 7.99918 0C4.87193 0 2.17378 1.79636 0.857422 4.41455L3.5192 6.48001C4.15189 4.58908 5.91919 3.18545 7.99918 3.18545Z" fill="#EA4335"/>
</svg>`;

export function GoogleIcon({ size = 18 }: { size?: number }) {
  return <SvgXml xml={GOOGLE_G} width={size} height={size} />;
}

// The GitHub mark - same path as the web login button. `color` matches the
// button's foreground (white on the filled primary button).
function githubSvg(color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
<path fill-rule="evenodd" clip-rule="evenodd" fill="${color}" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
</svg>`;
}

export function GithubIcon({ size = 18, color = "#ffffff" }: { size?: number; color?: string }) {
  return <SvgXml xml={githubSvg(color)} width={size} height={size} />;
}

const appleSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
<path fill="${color}" d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
</svg>`;

export function AppleIcon({ size = 18, color = "#ffffff" }: { size?: number; color?: string }) {
  return <SvgXml xml={appleSvg(color)} width={size} height={size} />;
}

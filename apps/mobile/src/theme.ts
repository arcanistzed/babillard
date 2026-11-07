import { useColorScheme } from "react-native";

export const fonts = {
  display: "BricolageGrotesque_800ExtraBold",
  displayMedium: "BricolageGrotesque_600SemiBold",
  body: "AtkinsonHyperlegible_400Regular",
  bodyBold: "AtkinsonHyperlegible_700Bold",
};

const light = {
  paper: "#EEF0F8",
  surface: "#FFFFFF",
  ink: "#15173D",
  muted: "#55597A",
  line: "#D5D8E8",
  accent: "#C7146F",
  onAccent: "#FFFFFF",
  danger: "#B3261E",
  good: "#0B6B4F",
};

const dark: typeof light = {
  paper: "#13142E",
  surface: "#1E2045",
  ink: "#EEF0FA",
  muted: "#A9ADCB",
  line: "#34376B",
  accent: "#FF6AAE",
  onAccent: "#15173D",
  danger: "#FF8A80",
  good: "#6FE0B8",
};

export type Palette = typeof light;

export function useTheme(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

const DARK_INK = "#15173D";
const WHITE = "#FFFFFF";

/** Each field prints in its own ink, like flyers from different departments. Every pair meets AA contrast. */
const FLYER_INKS: Record<string, { bg: string; fg: string }> = {
  economics: { bg: "#FFC21A", fg: DARK_INK },
  politics: { bg: "#FF6A47", fg: DARK_INK },
  law: { bg: "#2B46D6", fg: WHITE },
  history: { bg: "#00727A", fg: WHITE },
  philosophy: { bg: "#6B3FC9", fg: WHITE },
  sociology: { bg: "#FF5FAE", fg: DARK_INK },
  psychology: { bg: "#2ED3A5", fg: DARK_INK },
  literature: { bg: "#A3154F", fg: WHITE },
  linguistics: { bg: "#BBDD2E", fg: DARK_INK },
  art: { bg: "#FF8A70", fg: DARK_INK },
  biology: { bg: "#17794A", fg: WHITE },
  medicine: { bg: "#39C3E8", fg: DARK_INK },
  physics: { bg: "#1B1E7A", fg: WHITE },
  chemistry: { bg: "#FF9420", fg: DARK_INK },
  mathematics: { bg: "#B9A6FF", fg: DARK_INK },
  computer_science: { bg: "#0A6885", fg: WHITE },
  engineering: { bg: "#37507A", fg: WHITE },
  environment: { bg: "#74C43C", fg: DARK_INK },
  education: { bg: "#FFD95C", fg: DARK_INK },
  urbanism: { bg: "#C93410", fg: WHITE },
  business: { bg: "#8A5A00", fg: WHITE },
  media: { bg: "#FFB3C7", fg: DARK_INK },
  public_policy: { bg: "#3C2A9E", fg: WHITE },
  religion: { bg: "#5C3317", fg: WHITE },
  indigenous_studies: { bg: "#7A2E0E", fg: WHITE },
  music_film: { bg: "#2A0F45", fg: WHITE },
};

const FALLBACK_INK = { bg: "#FF5FAE", fg: DARK_INK };

export function flyerInk(fieldTag: string | undefined): { bg: string; fg: string } {
  return (fieldTag && FLYER_INKS[fieldTag]) || FALLBACK_INK;
}

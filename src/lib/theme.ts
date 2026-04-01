// Dark theme matching Tails web — zinc backgrounds, emerald accent
export const colors = {
  // Backgrounds
  black: "#000000",
  bg: "#09090b", // zinc-950
  card: "#18181b", // zinc-900
  cardHover: "#27272a", // zinc-800
  border: "#27272a", // zinc-800
  borderLight: "#3f3f46", // zinc-700

  // Text
  text: "#fafafa", // zinc-50
  textSecondary: "#a1a1aa", // zinc-400
  textMuted: "#71717a", // zinc-500
  textDim: "#52525b", // zinc-600

  // Accent
  emerald: "#10b981", // emerald-500
  emeraldLight: "#34d399", // emerald-400
  emeraldDark: "#059669", // emerald-600
  emeraldBg: "rgba(16, 185, 129, 0.1)",
  emeraldBgStrong: "rgba(16, 185, 129, 0.2)",

  // Status
  red: "#f87171", // red-400
  redBg: "rgba(248, 113, 113, 0.1)",
  green: "#4ade80", // green-400
  blue: "#60a5fa", // blue-400
  yellow: "#fbbf24", // amber-400

  // Skeleton shimmer
  skeleton1: "#27272a",
  skeleton2: "#3f3f46",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  title: 28,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

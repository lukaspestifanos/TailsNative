// Time formatting — matches web app's formatTime patterns

export function timeAgo(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "now";
}

export function fullDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function formatPickType(
  type: string,
  homeTeam: string,
  awayTeam: string
): string {
  switch (type) {
    case "spread_home":
    case "ml_home":
      return homeTeam;
    case "spread_away":
    case "ml_away":
      return awayTeam;
    case "over":
      return "Over";
    case "under":
      return "Under";
    default:
      return type;
  }
}

export function formatPickLabel(
  type: string,
  line: number | null,
  odds: number | null
): string {
  const oddsStr = odds ? formatOdds(odds) : "";
  if (type.startsWith("spread_") && line !== null) {
    return `${line > 0 ? "+" : ""}${line} (${oddsStr})`;
  }
  if (type.startsWith("ml_")) {
    return `ML (${oddsStr})`;
  }
  if ((type === "over" || type === "under") && line !== null) {
    return `${line} (${oddsStr})`;
  }
  return oddsStr;
}

// Mirrors web app's lib/utils/parseImageUrls.ts
// Handles both legacy single URL strings and JSON array strings

export function parseImageUrls(imageUrl: string | null | undefined): string[] {
  if (!imageUrl) return [];

  if (imageUrl.startsWith("[")) {
    try {
      const parsed = JSON.parse(imageUrl);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      // Not valid JSON, treat as single URL
    }
  }

  return [imageUrl];
}

export function isVideo(url: string): boolean {
  return /\.(mp4|mov|webm|m4v)/i.test(url) || url.includes("video");
}

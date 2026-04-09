// Shared interaction state cache — syncs like/tail state across screens
// PostCard and PostDetailScreen both read/write here so navigating back reflects changes

type InteractionState = {
  liked: boolean;
  likeCount: number;
  tailed: boolean;
  tailCount: number;
};

const cache = new Map<string, InteractionState>();

export function getInteraction(postId: string): InteractionState | undefined {
  return cache.get(postId);
}

export function setInteraction(postId: string, state: InteractionState) {
  cache.set(postId, state);
}

// Shared types — mirrors the web app's lib/types/index.ts

export interface Profile {
  id: string;
  username: string;
  name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
  favorite_leagues?: string[];
}

export interface ProfileSummary {
  username: string | null;
  name: string | null;
  avatar_url: string | null;
  last_active_at: string | null;
}

export interface Game {
  id: string;
  league: string;
  home_team: string;
  away_team: string;
  start_time: string;
  score_home: number | null;
  score_away: number | null;
  status: string | null;
  home_logo: string | null;
  away_logo: string | null;
}

export interface GameWithOdds extends Game {
  odds: OddsData[];
  slipCount?: number;
}

export interface OddsData {
  game_id: string;
  sportsbook: string;
  spread: number | null;
  spread_price: number | null;
  moneyline_home: number | null;
  moneyline_away: number | null;
  total: number | null;
  updated_at: string;
}

export type PickType =
  | "spread_home"
  | "spread_away"
  | "ml_home"
  | "ml_away"
  | "over"
  | "under"
  | "player_over"
  | "player_under";

export type PickResult = "pending" | "win" | "loss" | "push";

export interface ParlayLeg {
  id: string;
  parlay_id: string;
  game_id: string;
  pick_type: string;
  pick_line: number | null;
  pick_odds: number;
  pick_sportsbook: string;
  result: PickResult;
  graded_at: string | null;
  leg_order: number;
  games?: Game | null;
}

export interface Parlay {
  id: string;
  user_id: string;
  created_at: string;
  total_odds: number;
  result: PickResult;
  graded_at: string | null;
  legs_count: number;
  parlay_legs: ParlayLeg[];
}

export interface Post {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  likes_count: number;
  comments_count: number;
  tails_count: number;
  profiles: ProfileSummary | null;
  game_id: string | null;
  pick_type: string | null;
  pick_line: number | null;
  pick_odds: number | null;
  pick_sportsbook: string | null;
  pick_result: PickResult | null;
  graded_at: string | null;
  parlay_id: string | null;
  parlay: Parlay | null;
  games: Game | null;
  edited_at: string | null;
  original_content: string | null;
  quote_post_id: string | null;
  quote_post: Post | null;
  pinned_at: string | null;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  gif_url?: string | null;
  created_at: string;
  parent_id: string | null;
  profiles: ProfileSummary | null;
  replies?: Comment[];
  likes_count?: number;
  tails_count?: number;
}

export interface Conversation {
  id: string;
  type: "dm" | "group";
  name: string | null;
  updated_at: string;
  last_message?: string | null;
  last_message_at?: string | null;
  participants: ProfileSummary[];
  unread?: boolean;
}

export interface Message {
  id: string;
  sender_id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  reply_to_id: string | null;
  reactions: { emoji: string; user_ids: string[] }[];
}

export interface Notification {
  id: string;
  type: "like" | "comment" | "follow" | "tail" | "mention";
  actor: ProfileSummary;
  post_id?: string;
  created_at: string;
  read: boolean;
}

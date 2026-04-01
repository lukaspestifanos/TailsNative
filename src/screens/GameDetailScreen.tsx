import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  AppState,
  Pressable,
  ScrollView,
  Animated,
} from "react-native";
import { Image } from "expo-image";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { API_BASE, supabase } from "../lib/supabase";
import type { Post } from "../lib/types";
import PostCard from "../components/PostCard";
import { PostDetailSkeleton } from "../components/Skeleton";

type Route = RouteProp<RootStackParamList, "GameDetail">;

type GameData = {
  id: string;
  league: string;
  home_team: string;
  away_team: string;
  score_home: number | null;
  score_away: number | null;
  status: string | null;
  start_time: string;
  home_logo: string | null;
  away_logo: string | null;
  period?: number;
  clock?: string;
  spread?: number | null;
  over_under?: number | null;
  home_ml?: number | null;
  away_ml?: number | null;
  win_prob_home?: number | null;
  win_prob_away?: number | null;
};

const MMA_LEAGUES = ["UFC", "PFL", "Bellator"];

// ESPN scoreboard URLs by league — for direct live score polling
function getScoreboardUrl(league: string): string | null {
  const base = "https://site.api.espn.com/apis/site/v2/sports";
  const map: Record<string, string> = {
    NBA: `${base}/basketball/nba/scoreboard`,
    NCAAM: `${base}/basketball/mens-college-basketball/scoreboard`,
    MLB: `${base}/baseball/mlb/scoreboard`,
    UFC: `${base}/mma/ufc/scoreboard`,
    PFL: `${base}/mma/pfl/scoreboard`,
    Bellator: `${base}/mma/bellator/scoreboard`,
    "Premier League": `${base}/soccer/eng.1/scoreboard`,
    "La Liga": `${base}/soccer/esp.1/scoreboard`,
    Bundesliga: `${base}/soccer/ger.1/scoreboard`,
    "Serie A": `${base}/soccer/ita.1/scoreboard`,
    "Ligue 1": `${base}/soccer/fra.1/scoreboard`,
    UCL: `${base}/soccer/uefa.champions/scoreboard`,
    "Europa League": `${base}/soccer/uefa.europa/scoreboard`,
    "World Cup": `${base}/soccer/fifa.world/scoreboard`,
    "Copa America": `${base}/soccer/conmebol.america/scoreboard`,
    MLS: `${base}/soccer/usa.1/scoreboard`,
    Friendlies: `${base}/soccer/fifa.friendly/scoreboard`,
  };
  return map[league] || null;
}
const SOCCER_LEAGUES = ["Premier League", "Bundesliga", "La Liga", "Serie A", "Ligue 1", "UCL", "Europa League", "World Cup", "Copa America", "MLS", "Friendlies"];

type BoxPlayer = { id: string; name: string; headshot: string; stats: string[] };
type BoxCategory = { label: string; statLabels: string[]; players: BoxPlayer[] };
type BoxTeam = { name: string; logo: string; categories: BoxCategory[] };
type ScoringPlay = { text: string; clock: string; period: string; scoreValue: number; athleteId: string; awayScore: number; homeScore: number };
type TeamStatRow = { label: string; home: string; away: string };
type KeyEvent = { type: string; text: string; clock: string; team: string; athleteName: string; icon: string };

function getSummaryUrl(league: string): string | null {
  const base = "https://site.api.espn.com/apis/site/v2/sports";
  const map: Record<string, string> = {
    NBA: `${base}/basketball/nba/summary`,
    NCAAM: `${base}/basketball/mens-college-basketball/summary`,
    MLB: `${base}/baseball/mlb/summary`,
    "Premier League": `${base}/soccer/eng.1/summary`,
    Bundesliga: `${base}/soccer/ger.1/summary`,
    "La Liga": `${base}/soccer/esp.1/summary`,
    "Serie A": `${base}/soccer/ita.1/summary`,
    "Ligue 1": `${base}/soccer/fra.1/summary`,
    UCL: `${base}/soccer/uefa.champions/summary`,
    "Europa League": `${base}/soccer/uefa.europa/summary`,
    MLS: `${base}/soccer/usa.1/summary`,
    "World Cup": `${base}/soccer/fifa.world/summary`,
    "Copa America": `${base}/soccer/conmebol.america/summary`,
    Friendlies: `${base}/soccer/fifa.friendly/summary`,
  };
  return map[league] || null;
}

// Show ALL stat columns — the box score is horizontally scrollable
// No filtering needed

function formatOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function formatGameTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatStatusText(g: GameData): string {
  if (g.status === "live") {
    if (g.period && g.clock) {
      if (g.league === "NBA") return `Q${g.period} ${g.clock}`;
      if (g.league === "NCAAM") return `${g.period === 1 ? "1H" : "2H"} ${g.clock}`;
      if (g.league === "MLB") return `${g.period}th`;
      return `${g.clock}`;
    }
    return "LIVE";
  }
  if (g.status === "final") return "Final";
  return formatGameTime(g.start_time);
}

export default function GameDetailScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const gameId = params.gameId;
  const initialGame = params.game ? (params.game as GameData) : null;

  const [game, setGame] = useState<GameData | null>(initialGame);
  const gameRef = useRef<GameData | null>(initialGame);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sweepAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ESPN summary data
  const [boxTeams, setBoxTeams] = useState<BoxTeam[]>([]);
  const [recentPlays, setRecentPlays] = useState<ScoringPlay[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStatRow[]>([]);
  const [keyEvents, setKeyEvents] = useState<KeyEvent[]>([]);
  const [activeTab, setActiveTab] = useState<"posts" | "boxscore" | "plays">("posts");
  const summaryFetched = useRef(false);

  const fetchGame = useCallback(async (silent = false) => {
    try {
      // Try today's API first
      const res = await fetch(`${API_BASE}/api/games/today?_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        const all = [
          ...(data.games || []).map((g: any) => ({ ...g, league: g.league || "NBA" })),
          ...(data.mlb || []), ...(data.ncaam || []),
          ...(data.mma || []), ...(data.soccer || []), ...(data.tennis || []),
        ];
        const found = all.find((g: any) => g.id === gameId);
        if (found) { setGame(found); gameRef.current = found; }
      }

      // If game is live/known but wasn't in today's API, poll ESPN directly
      if (gameRef.current && gameRef.current.status === "live") {
        const parts = gameId.split("_");
        const espnId = parts[parts.length - 1];
        const sbUrl = getScoreboardUrl(gameRef.current.league);
        if (sbUrl && espnId) {
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const dateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, "");
          try {
            const espnRes = await fetch(`${sbUrl}?dates=${dateStr}`);
            if (espnRes.ok) {
              const espnData = await espnRes.json();
              for (const event of espnData.events || []) {
                if (event.id === espnId) {
                  const comp = event.competitions?.[0];
                  const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
                  const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
                  const updated: GameData = {
                    ...gameRef.current!,
                    score_home: parseInt(home?.score || "0"),
                    score_away: parseInt(away?.score || "0"),
                    status: event.status?.type?.completed ? "final" : event.status?.type?.state === "in" ? "live" : "scheduled",
                    period: event.status?.period || undefined,
                    clock: event.status?.displayClock || undefined,
                  };
                  setGame(updated);
                  gameRef.current = updated;
                  break;
                }
              }
            }
          } catch {}
        }
      }

      // Fallback 1: if game wasn't in today's API, try ESPN directly with yesterday's date
      if (!gameRef.current) {
        // Extract league and ESPN ID from gameId
        // Formats: "nba_espn_401810954", "soccer_premier_league_12345", "mma_ufc_12345"
        const parts = gameId.split("_");
        const espnId = parts[parts.length - 1];
        const leagueHint = parts[0]?.toUpperCase();

        // Soccer IDs embed the full league name: soccer_premier_league_12345 → "Premier League"
        // Reconstruct by dropping first segment (sport) and last segment (espnId)
        const SOCCER_ID_MAP: Record<string, string> = {
          premier_league: "Premier League", la_liga: "La Liga", bundesliga: "Bundesliga",
          serie_a: "Serie A", ligue_1: "Ligue 1", ucl: "UCL", europa_league: "Europa League",
          world_cup: "World Cup", copa_america: "Copa America", mls: "MLS", friendlies: "Friendlies",
        };
        let league: string;
        if (leagueHint === "SOCCER") {
          const leagueSlug = parts.slice(1, -1).join("_");
          league = SOCCER_ID_MAP[leagueSlug] || initialGame?.league || "Premier League";
        } else {
          league = leagueHint === "NBA" ? "NBA" : leagueHint === "MLB" ? "MLB" : leagueHint === "NCAAM" ? "NCAAM" : leagueHint === "MMA" ? (parts[1]?.toUpperCase() || "UFC") : leagueHint;
        }
        const sbUrl = getScoreboardUrl(league);

        if (sbUrl && espnId) {
          // Try yesterday's date
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const dateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, "");
          try {
            const espnRes = await fetch(`${sbUrl}?dates=${dateStr}`);
            if (espnRes.ok) {
              const espnData = await espnRes.json();
              for (const event of espnData.events || []) {
                if (event.id === espnId) {
                  const comp = event.competitions?.[0];
                  const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
                  const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
                  const g: GameData = {
                    id: gameId,
                    league,
                    home_team: home?.team?.displayName || "TBD",
                    away_team: away?.team?.displayName || "TBD",
                    score_home: parseInt(home?.score || "0"),
                    score_away: parseInt(away?.score || "0"),
                    status: event.status?.type?.completed ? "final" : event.status?.type?.state === "in" ? "live" : "scheduled",
                    start_time: event.date || "",
                    home_logo: home?.team?.logo || null,
                    away_logo: away?.team?.logo || null,
                    period: event.status?.period || undefined,
                    clock: event.status?.displayClock || undefined,
                    win_prob_home: home?.statistics?.find((s: any) => s.name === "gameProjection")?.value ?? null,
                    win_prob_away: away?.statistics?.find((s: any) => s.name === "gameProjection")?.value ?? null,
                  };
                  setGame(g);
                  gameRef.current = g;
                  break;
                }
              }
            }
          } catch {}
        }
      }

      // Fallback 2: Supabase (static, no live scores but at least shows the game)
      if (!gameRef.current) {
        const { data: dbGame } = await supabase
          .from("games")
          .select("id, league, home_team, away_team, score_home, score_away, status, start_time, home_logo, away_logo")
          .eq("id", gameId)
          .single();
        if (dbGame) { setGame(dbGame as GameData); gameRef.current = dbGame as GameData; }
      }

      // Fetch posts tagged to this game
      const { data: postRows } = await supabase
        .from("posts")
        .select(`
          id, user_id, content, image_url, created_at, game_id,
          pick_type, pick_line, pick_odds, pick_sportsbook, pick_result, graded_at,
          parlay_id, quote_post_id, edited_at, original_content, pinned_at,
          comments:comments(count),
          likes:likes(count),
          tails:tails(count)
        `)
        .eq("game_id", gameId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (postRows && postRows.length > 0) {
        const userIds = [...new Set(postRows.map((p: any) => p.user_id))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, username, name, avatar_url, last_active_at")
          .in("id", userIds);

        const profileMap: Record<string, any> = {};
        (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });

        const enriched: Post[] = postRows.map((row: any) => ({
          ...row,
          likes_count: row.likes?.[0]?.count ?? 0,
          comments_count: row.comments?.[0]?.count ?? 0,
          tails_count: row.tails?.[0]?.count ?? 0,
          profiles: profileMap[row.user_id]
            ? { username: profileMap[row.user_id].username, name: profileMap[row.user_id].name, avatar_url: profileMap[row.user_id].avatar_url, last_active_at: profileMap[row.user_id].last_active_at }
            : null,
          games: game || null,
          parlay: null,
          quote_post: null,
        }));
        setPosts(enriched);
      }
    } catch (err) {
      console.error("[GameDetail] fetch error:", err);
    }

    // Fallback: if game wasn't in today's scoreboard, pull from Supabase
    if (!gameRef.current) {
      try {
        const { data: dbGame } = await supabase
          .from("games")
          .select("id, league, home_team, away_team, score_home, score_away, status, start_time, home_logo, away_logo")
          .eq("id", gameId)
          .single();
        if (dbGame) { setGame(dbGame as GameData); gameRef.current = dbGame as GameData; }
      } catch {}
    }

    if (!silent) setLoading(false);
  }, [gameId]);

  // Initial + 15s polling
  useEffect(() => {
    fetchGame();
    intervalRef.current = setInterval(() => fetchGame(true), 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchGame]);

  // Pause/resume on app state
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        fetchGame(true);
        if (!intervalRef.current) intervalRef.current = setInterval(() => fetchGame(true), 15000);
      } else {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      }
    });
    return () => sub.remove();
  }, [fetchGame]);

  // Fetch ESPN summary (box score, plays) once game data is loaded
  useEffect(() => {
    if (!game || summaryFetched.current) return;
    const league = game.league;
    const espnId = gameId.split("_").pop() || "";
    const url = getSummaryUrl(league);
    if (!url || !espnId) return;
    summaryFetched.current = true;

    const isSoccer = SOCCER_LEAGUES.includes(league);

    (async () => {
      try {
        const res = await fetch(`${url}?event=${espnId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (isSoccer) {
          // === SOCCER: parse rosters, team stats, key events ===

          // Team stats comparison
          const bsTeams = data.boxscore?.teams || [];
          if (bsTeams.length === 2) {
            const STAT_DISPLAY: Record<string, string> = {
              possessionPct: "Possession %", totalShots: "Shots", shotsOnTarget: "Shots on Target",
              wonCorners: "Corners", foulsCommitted: "Fouls", yellowCards: "Yellow Cards",
              redCards: "Red Cards", offsides: "Offsides", saves: "Saves",
              accuratePasses: "Passes", passPct: "Pass Accuracy",
            };
            const ORDER = Object.keys(STAT_DISPLAY);
            const homeIdx = bsTeams.findIndex((t: any) => t.homeAway === "home") === -1 ? 1 : bsTeams.findIndex((t: any) => t.homeAway === "home");
            const awayIdx = homeIdx === 0 ? 1 : 0;
            const homeStats: Record<string, string> = {};
            const awayStats: Record<string, string> = {};
            for (const s of bsTeams[homeIdx]?.statistics || []) homeStats[s.name] = s.displayValue;
            for (const s of bsTeams[awayIdx]?.statistics || []) awayStats[s.name] = s.displayValue;
            const rows: TeamStatRow[] = [];
            for (const key of ORDER) {
              if (homeStats[key] != null || awayStats[key] != null) {
                const fmt = (v: string) => key === "passPct" ? `${Math.round(parseFloat(v || "0") * 100)}%` : v || "0";
                rows.push({ label: STAT_DISPLAY[key], home: fmt(homeStats[key]), away: fmt(awayStats[key]) });
              }
            }
            setTeamStats(rows);
          }

          // Lineups from rosters
          const SOCCER_STAT_LABELS = ["G", "A", "SH", "ST", "FC", "YC"];
          const SOCCER_STAT_KEYS = ["totalGoals", "goalAssists", "totalShots", "shotsOnTarget", "foulsCommitted", "yellowCards"];
          const teams: BoxTeam[] = [];
          for (const r of data.rosters || []) {
            const starters: BoxPlayer[] = [];
            const subs: BoxPlayer[] = [];
            for (const entry of r.roster || []) {
              const athlete = entry.athlete || {};
              const statMap: Record<string, string> = {};
              for (const s of entry.stats || []) statMap[s.name] = s.displayValue || "0";
              const player: BoxPlayer = {
                id: athlete.id || "",
                name: athlete.shortName || athlete.displayName || "",
                headshot: athlete.headshot?.href || "",
                stats: SOCCER_STAT_KEYS.map((k) => statMap[k] || "0"),
              };
              if (entry.starter) starters.push(player);
              else if (entry.subbedIn || entry.active) subs.push(player);
            }
            const categories: BoxCategory[] = [];
            if (starters.length > 0) categories.push({ label: `Starting XI${r.formation ? ` (${r.formation})` : ""}`, statLabels: SOCCER_STAT_LABELS, players: starters });
            if (subs.length > 0) categories.push({ label: "Substitutes", statLabels: SOCCER_STAT_LABELS, players: subs });
            if (categories.length > 0) {
              teams.push({
                name: r.team?.shortDisplayName || r.team?.displayName || "",
                logo: r.team?.logo || "",
                categories,
              });
            }
          }
          setBoxTeams(teams);

          // Key events (goals, cards, subs)
          const events: KeyEvent[] = [];
          for (const ke of data.keyEvents || []) {
            const typeText: string = ke.type?.text || "";
            if (typeText === "Kickoff" || typeText === "Halftime" || typeText.startsWith("Start") || typeText.startsWith("End")) continue;
            const icon = typeText.includes("Goal") ? "G" : typeText.includes("Yellow") ? "YC" : typeText.includes("Red") ? "RC" : typeText.includes("Substitution") ? "SUB" : "";
            if (!icon) continue;
            events.push({
              type: typeText,
              text: ke.text || "",
              clock: ke.clock?.displayValue || "",
              team: ke.team?.displayName || "",
              athleteName: ke.participants?.[0]?.athlete?.displayName || "",
              icon,
            });
          }
          setKeyEvents(events);
        } else {
          // === NON-SOCCER: original parsing ===

          // Box score
          const teams: BoxTeam[] = [];
          for (const td of data.boxscore?.players || []) {
            const categories: BoxCategory[] = [];
            for (const s of td.statistics || []) {
              const athletes = (s.athletes || []).filter((a: any) => !a.didNotPlay);
              if (athletes.length === 0) continue;
              categories.push({
                label: s.type || s.name || "",
                statLabels: s.names || [],
                players: athletes.map((a: any) => ({
                  id: a.athlete?.id || "",
                  name: a.athlete?.shortName || a.athlete?.displayName || "",
                  headshot: a.athlete?.headshot?.href || "",
                  stats: a.stats || [],
                })),
              });
            }
            if (categories.length > 0) {
              teams.push({
                name: td.team?.shortDisplayName || td.team?.displayName || "",
                logo: td.team?.logo || "",
                categories,
              });
            }
          }
          setBoxTeams(teams);

          // Recent scoring plays
          const plays = data.plays || [];
          const scoring = plays
            .filter((p: any) => p.scoringPlay)
            .slice(-8)
            .map((p: any) => ({
              text: p.text || "",
              clock: p.clock?.displayValue || "",
              period: p.period?.displayValue || "",
              scoreValue: p.scoreValue || 0,
              athleteId: p.participants?.[0]?.athlete?.id || "",
              awayScore: p.awayScore || 0,
              homeScore: p.homeScore || 0,
            }))
            .reverse();
          setRecentPlays(scoring);
        }
      } catch {}
    })();
  }, [game, gameId]);

  // Poll plays every 15s for live games
  useEffect(() => {
    if (!game || game.status !== "live") return;
    const league = game.league;
    const espnId = gameId.split("_").pop() || "";
    const url = getSummaryUrl(league);
    if (!url || !espnId) return;
    const isSoccer = SOCCER_LEAGUES.includes(league);

    const pollPlays = async () => {
      try {
        const res = await fetch(`${url}?event=${espnId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (isSoccer) {
          const events: KeyEvent[] = [];
          for (const ke of data.keyEvents || []) {
            const typeText: string = ke.type?.text || "";
            if (typeText === "Kickoff" || typeText === "Halftime" || typeText.startsWith("Start") || typeText.startsWith("End")) continue;
            const icon = typeText.includes("Goal") ? "G" : typeText.includes("Yellow") ? "YC" : typeText.includes("Red") ? "RC" : typeText.includes("Substitution") ? "SUB" : "";
            if (!icon) continue;
            events.push({ type: typeText, text: ke.text || "", clock: ke.clock?.displayValue || "", team: ke.team?.displayName || "", athleteName: ke.participants?.[0]?.athlete?.displayName || "", icon });
          }
          setKeyEvents(events);
        } else {
          const plays = data.plays || [];
          const scoring = plays
            .filter((p: any) => p.scoringPlay)
            .slice(-8)
            .map((p: any) => ({
              text: p.text || "",
              clock: p.clock?.displayValue || "",
              period: p.period?.displayValue || "",
              scoreValue: p.scoreValue || 0,
              athleteId: p.participants?.[0]?.athlete?.id || "",
              awayScore: p.awayScore || 0,
              homeScore: p.homeScore || 0,
            }))
            .reverse();
          setRecentPlays(scoring);
        }
      } catch {}
    };
    const interval = setInterval(pollPlays, 15000);
    return () => clearInterval(interval);
  }, [game?.status, gameId, game?.league]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchGame();
    setRefreshing(false);
  }, [fetchGame]);

  // Sweep animation for the probability bar (60%+ favorite)
  useEffect(() => {
    if (!game || game.status !== "live") return;
    let hp = game.win_prob_home ?? null;
    let ap = game.win_prob_away ?? null;
    if (hp == null && game.home_ml != null && game.away_ml != null) {
      const toProb = (ml: number) => ml < 0 ? Math.abs(ml) / (Math.abs(ml) + 100) : 100 / (ml + 100);
      const hRaw = toProb(game.home_ml);
      const aRaw = toProb(game.away_ml);
      const total = hRaw + aRaw;
      hp = (hRaw / total) * 100;
      ap = (aRaw / total) * 100;
    }
    const favPct = Math.max(hp ?? 0, ap ?? 0);
    if (favPct >= 60) {
      const sweep = Animated.loop(
        Animated.timing(sweepAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
      );
      sweep.start();
      return () => sweep.stop();
    } else {
      sweepAnim.setValue(0);
    }
  }, [game?.status, game?.win_prob_home, game?.win_prob_away, game?.home_ml, game?.away_ml, sweepAnim]);

  // Pulse animation for blowout (75%+)
  useEffect(() => {
    if (!game || game.status !== "live") return;
    let hp = game.win_prob_home ?? null;
    let ap = game.win_prob_away ?? null;
    if (hp == null && game.home_ml != null && game.away_ml != null) {
      const toProb = (ml: number) => ml < 0 ? Math.abs(ml) / (Math.abs(ml) + 100) : 100 / (ml + 100);
      const hRaw = toProb(game.home_ml);
      const aRaw = toProb(game.away_ml);
      const total = hRaw + aRaw;
      hp = (hRaw / total) * 100;
      ap = (aRaw / total) * 100;
    }
    const favPct = Math.max(hp ?? 0, ap ?? 0);
    if (favPct >= 75) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [game?.status, game?.win_prob_home, game?.win_prob_away, game?.home_ml, game?.away_ml, pulseAnim]);

  if (loading && !game) {
    return <View style={styles.container}><PostDetailSkeleton /></View>;
  }

  if (!game) {
    return (
      <View style={[styles.container, styles.empty]}>
        <Text style={styles.emptyTitle}>Game not found</Text>
        <Pressable onPress={onRefresh} style={styles.retryButton}>
          <Text style={styles.retryText}>Tap to retry</Text>
        </Pressable>
      </View>
    );
  }

  const isLive = game.status === "live";
  const isFinal = game.status === "final";
  const hasScore = game.score_home !== null && game.score_away !== null;
  const statusText = formatStatusText(game);

  // Win probability — primary: ESPN live data, fallback: derived from moneylines
  let prediction: { home: number; away: number } | null = null;
  if (game.win_prob_home != null && game.win_prob_away != null) {
    prediction = { home: game.win_prob_home, away: game.win_prob_away };
  } else if (game.home_ml != null && game.away_ml != null) {
    const toProb = (ml: number) => ml < 0 ? Math.abs(ml) / (Math.abs(ml) + 100) : 100 / (ml + 100);
    const hRaw = toProb(game.home_ml);
    const aRaw = toProb(game.away_ml);
    const total = hRaw + aRaw;
    prediction = { home: (hRaw / total) * 100, away: (aRaw / total) * 100 };
  }
  const isSoccerGame = SOCCER_LEAGUES.includes(game.league);

  const Header = () => (
    <View>
      {/* Scoreboard */}
      <View style={styles.scoreboard}>
        {/* Status */}
        <View style={styles.statusRow}>
          {isLive && <View style={styles.liveDot} />}
          <Text style={[styles.statusText, isLive && styles.statusLive]}>
            {statusText}
          </Text>
          <Text style={styles.league}>{game.league}</Text>
        </View>

        {/* Teams + Scores */}
        <View style={styles.matchup}>
          {/* Away */}
          <View style={styles.teamCol}>
            {game.away_logo ? (
              <Image source={{ uri: game.away_logo }} style={styles.teamLogo} contentFit="contain" />
            ) : (
              <View style={styles.teamLogoFallback}>
                <Text style={styles.teamLogoLetter}>{game.away_team.split(" ").pop()?.[0]}</Text>
              </View>
            )}
            <Text style={styles.teamName} numberOfLines={2}>{game.away_team}</Text>
          </View>

          {/* Score / vs */}
          <View style={styles.scoreCol}>
            {hasScore ? (
              <View style={styles.scoreRow}>
                <Text style={[styles.scoreNum, isFinal && game.score_away! > game.score_home! && styles.scoreWin]}>
                  {game.score_away}
                </Text>
                <Text style={styles.scoreDash}>-</Text>
                <Text style={[styles.scoreNum, isFinal && game.score_home! > game.score_away! && styles.scoreWin]}>
                  {game.score_home}
                </Text>
              </View>
            ) : (
              <Text style={styles.vsText}>vs</Text>
            )}
          </View>

          {/* Home */}
          <View style={styles.teamCol}>
            {game.home_logo ? (
              <Image source={{ uri: game.home_logo }} style={styles.teamLogo} contentFit="contain" />
            ) : (
              <View style={styles.teamLogoFallback}>
                <Text style={styles.teamLogoLetter}>{game.home_team.split(" ").pop()?.[0]}</Text>
              </View>
            )}
            <Text style={styles.teamName} numberOfLines={2}>{game.home_team}</Text>
          </View>
        </View>

        {/* Win probability bar — favorite on left, sweep animation for 60%+ */}
        {prediction && (() => {
          const favPct = Math.max(prediction.away, prediction.home);
          const undPct = Math.min(prediction.away, prediction.home);
          const isBigFav = favPct >= 60;
          const isBlowout = favPct >= 75;
          const sweepTranslate = sweepAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [-80, 280],
          });
          return (
            <View style={styles.probSection}>
              <Text style={styles.probTitle}>Win Probability</Text>
              <View style={styles.probRow}>
                {/* Favorite % */}
                <Animated.Text style={[styles.probFavText, isBlowout && isLive && { opacity: pulseAnim }]}>
                  {Math.round(favPct)}%
                </Animated.Text>

                {/* Bar */}
                <View style={styles.probBar}>
                  {/* Favorite fill */}
                  <View style={[styles.probFillFav, { flex: favPct }]}>
                    {/* Sweep shimmer for live big favorites */}
                    {isBigFav && isLive && (
                      <Animated.View
                        style={[styles.probSweep, { transform: [{ translateX: sweepTranslate }] }]}
                      />
                    )}
                  </View>
                  {/* Underdog fill */}
                  <View style={[styles.probFillUnd, { flex: undPct }]} />
                </View>

                {/* Underdog % */}
                <Text style={styles.probUndText}>{Math.round(undPct)}%</Text>
              </View>
            </View>
          );
        })()}

        {/* Odds */}
        {(game.spread != null || game.over_under != null || game.home_ml != null) && (
          <View style={styles.oddsRow}>
            {game.spread != null && (
              <View style={styles.oddsPill}>
                <Text style={styles.oddsLabel}>Spread</Text>
                <Text style={styles.oddsValue}>{game.spread > 0 ? `+${game.spread}` : game.spread}</Text>
              </View>
            )}
            {game.over_under != null && (
              <View style={styles.oddsPill}>
                <Text style={styles.oddsLabel}>O/U</Text>
                <Text style={styles.oddsValue}>{game.over_under}</Text>
              </View>
            )}
            {game.home_ml != null && game.away_ml != null && (
              <View style={styles.oddsPill}>
                <Text style={styles.oddsLabel}>ML</Text>
                <Text style={styles.oddsValue}>{formatOdds(game.away_ml!)} / {formatOdds(game.home_ml!)}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Tabs — Posts / Box Score / Plays */}
      <View style={styles.tabs}>
        {[
          { id: "posts" as const, label: "Posts", count: posts.length },
          { id: "boxscore" as const, label: isSoccerGame ? "Stats" : "Box Score", count: isSoccerGame ? teamStats.length + boxTeams.reduce((s, t) => s + t.categories.reduce((c, cat) => c + cat.players.length, 0), 0) : boxTeams.reduce((s, t) => s + t.categories.reduce((c, cat) => c + cat.players.length, 0), 0) },
          { id: "plays" as const, label: isSoccerGame ? "Events" : "Plays", count: isSoccerGame ? keyEvents.length : recentPlays.length },
        ].map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>
              {tab.label}
              {tab.count > 0 ? ` (${tab.count})` : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Soccer team stats comparison */}
      {activeTab === "boxscore" && isSoccerGame && teamStats.length > 0 && (
        <View style={styles.teamStatsSection}>
          <View style={styles.teamStatsHeader}>
            <Text style={styles.teamStatsTeamName} numberOfLines={1}>{game.away_team}</Text>
            <Text style={styles.teamStatsLabel}>Team Stats</Text>
            <Text style={styles.teamStatsTeamName} numberOfLines={1}>{game.home_team}</Text>
          </View>
          {teamStats.map((row, i) => (
            <View key={i} style={[styles.teamStatsRow, i % 2 === 0 && styles.teamStatsRowAlt]}>
              <Text style={styles.teamStatsValue}>{row.away}</Text>
              <Text style={styles.teamStatsStatName}>{row.label}</Text>
              <Text style={styles.teamStatsValue}>{row.home}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Box Score / Lineups content (rendered in header so it scrolls with the page) */}
      {activeTab === "boxscore" && boxTeams.length > 0 && (
        <View style={styles.boxSection}>
          {boxTeams.map((team, ti) => (
            <View key={ti} style={styles.boxTeam}>
              <View style={styles.boxTeamHeader}>
                {team.logo ? <Image source={{ uri: team.logo }} style={styles.boxTeamLogo} contentFit="contain" /> : null}
                <Text style={styles.boxTeamName}>{team.name}</Text>
              </View>
              {team.categories.map((cat, ci) => (
                <View key={ci}>
                  {team.categories.length > 1 && (
                    <Text style={styles.boxCatLabel}>{cat.label}</Text>
                  )}
                  {/* Horizontally scrollable stat table */}
                  <View style={styles.boxTable}>
                    {/* Pinned player column */}
                    <View style={styles.boxPinned}>
                      <View style={styles.boxPinnedHeader}>
                        <Text style={styles.boxHeaderText}>Player</Text>
                      </View>
                      {cat.players.map((player, pi) => (
                        <Pressable
                          key={pi}
                          style={[styles.boxPinnedRow, pi % 2 === 0 && styles.boxRowAlt]}
                          onPress={() => player.id && navigation.navigate("Player", {
                            athleteId: player.id,
                            name: player.name,
                            headshot: player.headshot,
                            league: game!.league,
                            stats: player.stats,
                            statLabels: cat.statLabels,
                          })}
                        >
                          {player.headshot ? (
                            <Image source={{ uri: player.headshot }} style={styles.boxHeadshot} contentFit="cover" />
                          ) : null}
                          <Text style={styles.boxPlayerName} numberOfLines={1}>{player.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {/* Scrollable stats */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={true}>
                      <View>
                        {/* Header */}
                        <View style={styles.boxStatsHeaderRow}>
                          {cat.statLabels.map((l, i) => (
                            <Text key={i} style={styles.boxStatHeader}>{l}</Text>
                          ))}
                        </View>
                        {/* Rows */}
                        {cat.players.map((player, pi) => (
                          <View key={pi} style={[styles.boxStatsRow, pi % 2 === 0 && styles.boxRowAlt]}>
                            {player.stats.map((s, si) => (
                              <Text key={si} style={styles.boxStatValue}>{s}</Text>
                            ))}
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {activeTab === "boxscore" && boxTeams.length === 0 && teamStats.length === 0 && (
        <View style={styles.emptyTab}>
          <Text style={styles.emptyText}>{isSoccerGame ? "Stats not available yet" : "Box score not available yet"}</Text>
        </View>
      )}

      {/* Soccer key events */}
      {activeTab === "plays" && isSoccerGame && keyEvents.length > 0 && (
        <View style={styles.playsSection}>
          {keyEvents.map((evt, i) => {
            const iconColor = evt.icon === "G" ? colors.emerald : evt.icon === "RC" ? "#ef4444" : evt.icon === "YC" ? "#eab308" : colors.textMuted;
            const iconBg = evt.icon === "G" ? "rgba(16,185,129,0.15)" : evt.icon === "RC" ? "rgba(239,68,68,0.15)" : evt.icon === "YC" ? "rgba(234,179,8,0.15)" : "rgba(255,255,255,0.05)";
            return (
              <View key={i} style={[styles.eventRow, evt.icon === "G" && styles.eventRowGoal]}>
                <View style={[styles.eventIconBadge, { backgroundColor: iconBg }]}>
                  <Text style={[styles.eventIconText, { color: iconColor }]}>{evt.icon}</Text>
                </View>
                <View style={styles.eventContent}>
                  <Text style={[styles.eventText, evt.icon === "G" && styles.eventTextGoal]} numberOfLines={evt.icon === "G" ? 3 : 1}>
                    {evt.text}
                  </Text>
                  <View style={styles.eventMeta}>
                    <Text style={styles.eventClock}>{evt.clock}</Text>
                    {evt.team ? <Text style={styles.eventTeam}>{evt.team}</Text> : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Non-soccer scoring plays */}
      {activeTab === "plays" && !isSoccerGame && recentPlays.length > 0 && (
        <View style={styles.playsSection}>
          {recentPlays.map((play, i) => {
            const league = game?.league || "";
            const sport = league === "MLB" ? "mlb" : league === "NCAAM" ? "mens-college-basketball" : "nba";
            const headshot = play.athleteId
              ? `https://a.espncdn.com/i/headshots/${sport}/players/full/${play.athleteId}.png`
              : null;
            const isFirst = i === 0;

            return (
              <View key={i} style={[styles.playRow, isFirst && styles.playRowFeatured]}>
                {headshot && (
                  <Image source={{ uri: headshot }} style={[styles.playHeadshot, isFirst && styles.playHeadshotFeatured]} contentFit="cover" />
                )}
                <View style={styles.playContent}>
                  <Text style={[styles.playText, isFirst && styles.playTextFeatured]} numberOfLines={isFirst ? 3 : 1}>
                    {play.text}
                  </Text>
                  <View style={styles.playMeta}>
                    <View style={[styles.playScoreBadge, play.scoreValue === 3 && styles.playScore3]}>
                      <Text style={styles.playScoreText}>+{play.scoreValue}</Text>
                    </View>
                    <Text style={styles.playTime}>{play.period} {play.clock}</Text>
                    <Text style={styles.playGameScore}>{play.awayScore}-{play.homeScore}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {activeTab === "plays" && ((isSoccerGame && keyEvents.length === 0) || (!isSoccerGame && recentPlays.length === 0)) && (
        <View style={styles.emptyTab}>
          <Text style={styles.emptyText}>{isSoccerGame ? "No events yet" : "No scoring plays yet"}</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={activeTab === "posts" ? posts : []}
        renderItem={({ item }) => <PostCard post={item} />}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={Header}
        ListEmptyComponent={
          activeTab === "posts" ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No posts yet</Text>
              <Text style={styles.emptyText}>Be the first to share your pick for this game</Text>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: 100 },

  // Scoreboard
  scoreboard: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: spacing.lg,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.emerald },
  statusText: { fontSize: fontSize.sm, fontWeight: "700", color: colors.textMuted },
  statusLive: { color: colors.emerald },
  league: { fontSize: fontSize.xs, color: colors.textDim, fontWeight: "600" },

  matchup: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  teamCol: { flex: 1, alignItems: "center", gap: spacing.sm },
  teamLogo: { width: 56, height: 56 },
  teamLogoFallback: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  teamLogoLetter: { fontSize: 22, fontWeight: "800", color: colors.textMuted },
  teamName: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text, textAlign: "center" },

  scoreCol: { paddingHorizontal: spacing.lg },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  scoreNum: { fontSize: 36, fontWeight: "800", color: colors.textSecondary },
  scoreWin: { color: colors.text },
  scoreDash: { fontSize: 24, color: colors.textDim },
  vsText: { fontSize: fontSize.lg, color: colors.textDim, fontWeight: "600" },

  // Win probability
  probSection: { marginTop: spacing.md },
  probTitle: { fontSize: 10, color: colors.textDim, fontWeight: "600", textTransform: "uppercase" as const, textAlign: "center" as const, marginBottom: 6 },
  probRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  probFavText: { fontSize: 11, fontWeight: "800", color: colors.emerald, width: 32, fontVariant: ["tabular-nums"] as any },
  probUndText: { fontSize: 11, fontWeight: "700", color: "#52525b", width: 32, textAlign: "right" as const, fontVariant: ["tabular-nums"] as any },
  probBar: { flex: 1, flexDirection: "row", height: 8, borderRadius: 4, backgroundColor: "#27272a", overflow: "hidden" },
  probFillFav: { backgroundColor: colors.emerald, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, overflow: "hidden", position: "relative" as const },
  probFillUnd: { backgroundColor: "#3f3f46", borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  probSweep: { position: "absolute" as const, top: 0, bottom: 0, width: 60, opacity: 0.35, backgroundColor: "#fff", borderRadius: 4 },

  // Odds
  oddsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    justifyContent: "center",
  },
  oddsPill: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignItems: "center",
  },
  oddsLabel: { fontSize: 9, color: colors.textDim, fontWeight: "700", textTransform: "uppercase", marginBottom: 1 },
  oddsValue: { fontSize: fontSize.sm, fontWeight: "700", color: colors.text },

  // Tabs
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: colors.emerald,
  },
  tabText: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textMuted },
  tabTextActive: { color: colors.emerald },

  // Box Score
  boxSection: { paddingBottom: spacing.lg },
  boxTeam: { marginTop: spacing.md },
  boxTeamHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(39,39,42,0.4)",
  },
  boxTeamLogo: { width: 20, height: 20 },
  boxTeamName: { fontSize: fontSize.sm, fontWeight: "700", color: colors.text },
  boxCatLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textDim,
    textTransform: "uppercase",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  boxTable: {
    flexDirection: "row",
  },
  // Pinned player name column on left
  boxPinned: {
    width: 110,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  boxPinnedHeader: {
    height: 28,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  boxPinnedRow: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.sm,
  },
  boxRowAlt: { backgroundColor: "rgba(39,39,42,0.2)" },
  boxHeaderText: { fontSize: 9, fontWeight: "700", color: colors.textDim, textTransform: "uppercase" as const },
  boxHeadshot: { width: 20, height: 20, borderRadius: 10 },
  boxPlayerName: { fontSize: 11, color: colors.textSecondary, flex: 1 },
  // Scrollable stat columns
  boxStatsHeaderRow: {
    flexDirection: "row",
    height: 28,
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  boxStatHeader: {
    width: 44,
    fontSize: 9,
    fontWeight: "700",
    color: colors.textDim,
    textAlign: "center",
    textTransform: "uppercase" as const,
  },
  boxStatsRow: {
    flexDirection: "row",
    height: 32,
    alignItems: "center",
  },
  boxStatValue: {
    width: 44,
    fontSize: 12,
    color: colors.text,
    fontWeight: "600",
    textAlign: "center",
  },

  // Plays
  playsSection: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  playRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  playRowFeatured: {
    backgroundColor: "rgba(16,185,129,0.08)",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.2)",
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
  },
  playHeadshot: { width: 20, height: 20, borderRadius: 10 },
  playHeadshotFeatured: { width: 40, height: 40, borderRadius: 20 },
  playContent: { flex: 1 },
  playText: { fontSize: fontSize.xs, color: colors.textMuted },
  playTextFeatured: { fontSize: fontSize.sm, color: colors.text, fontWeight: "600", lineHeight: 20 },
  playMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  playScoreBadge: {
    backgroundColor: colors.cardHover,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  playScore3: { backgroundColor: colors.emeraldBgStrong },
  playScoreText: { fontSize: 10, fontWeight: "700", color: colors.text },
  playTime: { fontSize: 10, color: colors.textMuted },
  playGameScore: { fontSize: 10, color: colors.textDim, marginLeft: "auto" },

  // Soccer team stats
  teamStatsSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  teamStatsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  teamStatsTeamName: { fontSize: 11, fontWeight: "700", color: colors.textSecondary, flex: 1 },
  teamStatsLabel: { fontSize: 10, fontWeight: "600", color: colors.textDim, textTransform: "uppercase" as const, textAlign: "center" as const, flex: 1 },
  teamStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
  },
  teamStatsRowAlt: { backgroundColor: "rgba(39,39,42,0.2)" },
  teamStatsStatName: { fontSize: 11, color: colors.textMuted, textAlign: "center" as const, flex: 1.5 },
  teamStatsValue: { fontSize: 12, fontWeight: "700", color: colors.text, flex: 1, textAlign: "center" as const },

  // Soccer key events
  eventRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  eventRowGoal: { backgroundColor: "rgba(16,185,129,0.05)" },
  eventIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  eventIconText: { fontSize: 10, fontWeight: "800" },
  eventContent: { flex: 1 },
  eventText: { fontSize: fontSize.xs, color: colors.textSecondary },
  eventTextGoal: { fontSize: fontSize.sm, color: colors.text, fontWeight: "600" },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 3 },
  eventClock: { fontSize: 10, fontWeight: "700", color: colors.textMuted },
  eventTeam: { fontSize: 10, color: colors.textDim },

  // Empty
  empty: { paddingVertical: 48, alignItems: "center", gap: spacing.sm },
  emptyTab: { paddingVertical: 40, alignItems: "center" },
  emptyTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.textMuted },
  emptyText: { fontSize: fontSize.sm, color: colors.textDim },
  retryButton: { marginTop: spacing.md, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  retryText: { fontSize: fontSize.sm, fontWeight: "600", color: colors.emerald },
});

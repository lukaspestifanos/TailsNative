import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  RefreshControl,
  ScrollView,
  AppState,
  TextInput,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { API_BASE, supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { FeedSkeleton } from "../components/Skeleton";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Game = {
  id: string;
  league: string;
  home_team: string;
  away_team: string;
  start_time: string;
  score_home: number | null;
  score_away: number | null;
  status: string | null;
  period?: number;
  clock?: string;
  home_logo?: string;
  away_logo?: string;
};

type Section = {
  league: string;
  liveCount: number;
  data: Game[];
};

const MMA_LEAGUES = ["UFC", "PFL", "Bellator"];
const SOCCER_LEAGUES = ["Premier League", "Bundesliga", "La Liga", "Serie A", "Ligue 1", "UCL", "Europa League", "World Cup", "Copa America", "MLS", "Friendlies"];
const TENNIS_LEAGUES = ["ATP", "WTA"];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "nba", label: "NBA", match: (l: string) => l === "NBA" },
  { id: "mlb", label: "MLB", match: (l: string) => l === "MLB" },
  { id: "ncaam", label: "NCAAM", match: (l: string) => l === "NCAAM" },
  { id: "mma", label: "MMA", match: (l: string) => MMA_LEAGUES.includes(l) },
  { id: "soccer", label: "Soccer", match: (l: string) => SOCCER_LEAGUES.includes(l) },
  { id: "tennis", label: "Tennis", match: (l: string) => TENNIS_LEAGUES.includes(l) },
];

const LEAGUE_ORDER = ["NBA", "MLB", "NCAAM", "Tennis", "Soccer", "UFC", "PFL", "Bellator"];

function sortGames(games: Game[]): Game[] {
  return [...games].sort((a, b) => {
    if (a.status === "live" && b.status !== "live") return -1;
    if (a.status !== "live" && b.status === "live") return 1;
    if (a.status !== "final" && b.status === "final") return -1;
    if (a.status === "final" && b.status !== "final") return 1;
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  });
}

function formatGameTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatStatusText(game: Game): string {
  if (game.status === "live") {
    const isMlb = game.league === "MLB";
    const isMma = MMA_LEAGUES.includes(game.league);
    const isTennis = TENNIS_LEAGUES.includes(game.league);
    const isSoccer = SOCCER_LEAGUES.includes(game.league);
    const isNcaam = game.league === "NCAAM";

    if (isMma) return game.period ? `R${game.period}` : "LIVE";
    if (isTennis) return game.period ? `Set ${game.period}` : "LIVE";
    if (isMlb) return game.period ? (game.period <= 9 ? `${game.period > 0 ? (game.period % 2 === 1 ? "Top" : "Bot") : ""} ${Math.ceil(game.period / 2)}` : `${game.period}th`) : "LIVE";
    if (isSoccer) return game.period && game.clock ? `${game.period === 1 ? "1H" : game.period === 2 ? "2H" : "ET"} ${game.clock}` : "LIVE";
    if (isNcaam) return game.period && game.clock ? `${game.period === 1 ? "1H" : "2H"} ${game.clock}` : "LIVE";
    return game.period && game.clock ? `Q${game.period} ${game.clock}` : "LIVE";
  }
  if (game.status === "final") return "Final";
  return formatGameTime(game.start_time);
}

// Map favorite league IDs from onboarding to actual league names for section ordering
const FAV_LEAGUE_MAP: Record<string, string[]> = {
  NBA: ["NBA"],
  MLB: ["MLB"],
  NCAAM: ["NCAAM"],
  soccer: ["Premier League", "Bundesliga", "La Liga", "Serie A", "Ligue 1", "UCL", "Europa League", "World Cup", "Copa America", "MLS", "Friendlies"],
  mma: ["UFC", "PFL", "Bellator"],
  tennis: ["ATP", "WTA"],
  golf: ["PGA", "LPGA"],
};

export default function GamesScreen() {
  const navigation = useNavigation<Nav>();
  const { profile } = useAuth();
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [totalLive, setTotalLive] = useState(0);
  const [search, setSearch] = useState("");
  const [playerResults, setPlayerResults] = useState<{ name: string; team: string; headshot: string; position: string; gameId: string | null }[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const allGamesRef = useRef<Game[]>([]);

  const fetchGames = useCallback(async (silent = false) => {
    try {
      const res = await fetch(`${API_BASE}/api/games/today?_t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();

      const todayGames: Game[] = [
        ...(data.games || []).map((g: any) => ({ ...g, league: g.league || "NBA" })),
        ...(data.mlb || []),
        ...(data.ncaam || []),
        ...(data.mma || []),
        ...(data.soccer || []),
        ...(data.tennis || []),
      ];

      // Also fetch yesterday's ESPN scoreboards directly — catches
      // last night's live/final games with real-time scores
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const dateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, "");
      const todayIds = new Set(todayGames.map((g) => g.id));

      const espnUrls = [
        { url: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`, league: "NBA" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dateStr}`, league: "MLB" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=${dateStr}`, league: "Premier League" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=${dateStr}`, league: "La Liga" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard?dates=${dateStr}`, league: "Bundesliga" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1/scoreboard?dates=${dateStr}`, league: "Serie A" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/fra.1/scoreboard?dates=${dateStr}`, league: "Ligue 1" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=${dateStr}`, league: "UCL" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.europa/scoreboard?dates=${dateStr}`, league: "Europa League" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`, league: "World Cup" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.america/scoreboard?dates=${dateStr}`, league: "Copa America" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard?dates=${dateStr}`, league: "MLS" },
        { url: `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.friendly/scoreboard?dates=${dateStr}`, league: "Friendlies" },
      ];

      const yesterdayGames: Game[] = [];
      const cutoff = Date.now() - 18 * 60 * 60 * 1000; // 18h ago
      await Promise.all(espnUrls.map(async ({ url, league: lg }) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return;
          const d = await r.json();
          for (const event of d.events || []) {
            const comp = event.competitions?.[0];
            const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
            const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
            const isSoccerLeague = SOCCER_LEAGUES.includes(lg);
            const id = isSoccerLeague
              ? `soccer_${lg.toLowerCase().replace(/\s+/g, "_")}_${event.id}`
              : `${lg.toLowerCase()}_espn_${event.id}`;
            if (todayIds.has(id)) continue; // already in today's list
            const isCompleted = event.status?.type?.completed === true;
            const eventTime = new Date(event.date || 0).getTime();
            if (isCompleted && eventTime < cutoff) continue; // skip old finals
            yesterdayGames.push({
              id,
              league: lg,
              home_team: home?.team?.displayName || "TBD",
              away_team: away?.team?.displayName || "TBD",
              score_home: parseInt(home?.score || "0"),
              score_away: parseInt(away?.score || "0"),
              status: isCompleted ? "final" : event.status?.type?.state === "in" ? "live" : "scheduled",
              start_time: event.date || "",
              home_logo: home?.team?.logo || undefined,
              away_logo: away?.team?.logo || undefined,
              period: event.status?.period || undefined,
              clock: event.status?.displayClock || undefined,
            });
          }
        } catch {}
      }));

      const allGames = [...todayGames, ...yesterdayGames];
      allGamesRef.current = allGames;

      // Group by league
      const byLeague: Record<string, Game[]> = {};
      for (const g of allGames) {
        const key = g.league;
        if (!byLeague[key]) byLeague[key] = [];
        byLeague[key].push(g);
      }

      const built: Section[] = [];
      for (const [league, games] of Object.entries(byLeague)) {
        const sorted = sortGames(games);
        const liveCount = sorted.filter((g) => g.status === "live").length;
        built.push({ league, liveCount, data: sorted });
      }

      // Sort sections: live first, then favorites, then default league order
      const favLeagues = new Set(
        (profile?.favorite_leagues || []).flatMap((fav: string) => FAV_LEAGUE_MAP[fav] || [fav])
      );
      built.sort((a, b) => {
        if (a.liveCount > 0 && b.liveCount === 0) return -1;
        if (a.liveCount === 0 && b.liveCount > 0) return 1;
        const aFav = favLeagues.has(a.league) ? 0 : 1;
        const bFav = favLeagues.has(b.league) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        const ai = LEAGUE_ORDER.indexOf(a.league);
        const bi = LEAGUE_ORDER.indexOf(b.league);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

      setSections(built);
      setTotalLive(built.reduce((s, sec) => s + sec.liveCount, 0));
    } catch {}
    if (!silent) setLoading(false);
  }, []);

  // Initial load + 15s polling
  useEffect(() => {
    fetchGames();
    intervalRef.current = setInterval(() => fetchGames(true), 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchGames]);

  // Pause polling when app is backgrounded, resume when foregrounded
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        fetchGames(true);
        if (!intervalRef.current) intervalRef.current = setInterval(() => fetchGames(true), 15000);
      } else {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      }
    });
    return () => sub.remove();
  }, [fetchGames]);

  // Player→team search via our own Supabase players table (no ESPN dependency)
  // Typing "LeBron" → queries players table → finds "Los Angeles Lakers" → shows Lakers game
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setPlayerResults([]); return; }

    const lq = q.toLowerCase();
    const teamMatch = allGamesRef.current.some((g) =>
      g.home_team.toLowerCase().includes(lq) || g.away_team.toLowerCase().includes(lq)
    );
    if (teamMatch) { setPlayerResults([]); return; }

    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        // Search our own players table
        const { data: players } = await supabase
          .from("players")
          .select("team")
          .ilike("name", `%${q}%`)
          .eq("is_active", true)
          .limit(10);

        if (!players || players.length === 0) {
          setPlayerResults([]);
          return;
        }

        const teamNames = new Set(players.map((p: any) => p.team));

        const matched = allGamesRef.current.filter((g) =>
          teamNames.has(g.home_team) || teamNames.has(g.away_team)
        );

        setPlayerResults(matched.map((g) => ({
          name: "", team: "", headshot: "", position: "",
          gameId: g.id,
        })));
      } catch {}
    }, 300);

    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchGames();
    setRefreshing(false);
  }, [fetchGames]);

  // Filter by sport chip
  const sportFiltered = filter === "all"
    ? sections
    : sections.filter((s) => {
        const f = FILTERS.find((fi) => fi.id === filter);
        return f?.match?.(s.league) ?? false;
      });

  // Filter by search — team names, league, + player→team matches from ESPN
  const query = search.trim().toLowerCase();
  const playerGameIds = new Set(playerResults.map((p) => p.gameId).filter(Boolean));
  const filtered = query
    ? sportFiltered.map((s) => ({
        ...s,
        data: s.data.filter((g) =>
          g.home_team.toLowerCase().includes(query) ||
          g.away_team.toLowerCase().includes(query) ||
          g.league.toLowerCase().includes(query) ||
          playerGameIds.has(g.id)
        ),
      })).filter((s) => s.data.length > 0)
    : sportFiltered;

  // Which filters have games today
  const activeFilters = FILTERS.filter((f) => {
    if (f.id === "all") return true;
    return sections.some((s) => f.match?.(s.league));
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Games</Text>
        </View>
        <FeedSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Games</Text>
          {totalLive > 0 && (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{totalLive} live</Text>
            </View>
          )}
        </View>

        {/* Search bar */}
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search teams, players, leagues..."
            placeholderTextColor={colors.textDim}
            returnKeyType="search"
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
        </View>

        {/* Sport filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterContent}>
          {activeFilters.map((f) => {
            const active = filter === f.id;
            const liveCount = f.id === "all" ? totalLive : sections.filter((s) => f.match?.(s.league)).reduce((sum, s) => sum + s.liveCount, 0);
            return (
              <Pressable
                key={f.id}
                onPress={() => setFilter(f.id)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
                {liveCount > 0 && (
                  <View style={[styles.chipDot, active && styles.chipDotActive]} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <SectionList
        sections={filtered}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLeague}>{section.league}</Text>
            {section.liveCount > 0 && (
              <View style={styles.sectionLive}>
                <View style={styles.liveDotSmall} />
                <Text style={styles.sectionLiveText}>{section.liveCount}</Text>
              </View>
            )}
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <GameRow game={item} onPress={() => navigation.navigate("GameDetail", { gameId: item.id, game: item })} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No games today</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

function GameRow({ game, onPress }: { game: Game; onPress: () => void }) {
  const isLive = game.status === "live";
  const isFinal = game.status === "final";
  const hasScore = game.score_home !== null && game.score_away !== null;
  const statusText = formatStatusText(game);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      {/* Status */}
      <Text style={[styles.status, isLive && styles.statusLive]}>{statusText}</Text>

      {/* Teams + scores */}
      <View style={styles.teams}>
        {/* Away */}
        <View style={styles.teamRow}>
          {game.away_logo ? (
            <Image source={{ uri: game.away_logo }} style={styles.teamLogo} contentFit="contain" />
          ) : (
            <View style={styles.teamLogoFallback}>
              <Text style={styles.teamLogoLetter}>{game.away_team.split(" ").pop()?.[0] || "?"}</Text>
            </View>
          )}
          <Text style={styles.teamName} numberOfLines={1}>{game.away_team}</Text>
          {hasScore && (
            <Text style={[
              styles.score,
              isFinal && game.score_away! > game.score_home! && styles.scoreWin,
              isFinal && game.score_away! < game.score_home! && styles.scoreLoss,
            ]}>
              {game.score_away}
            </Text>
          )}
        </View>
        {/* Home */}
        <View style={styles.teamRow}>
          {game.home_logo ? (
            <Image source={{ uri: game.home_logo }} style={styles.teamLogo} contentFit="contain" />
          ) : (
            <View style={styles.teamLogoFallback}>
              <Text style={styles.teamLogoLetter}>{game.home_team.split(" ").pop()?.[0] || "?"}</Text>
            </View>
          )}
          <Text style={styles.teamName} numberOfLines={1}>{game.home_team}</Text>
          {hasScore && (
            <Text style={[
              styles.score,
              isFinal && game.score_home! > game.score_away! && styles.scoreWin,
              isFinal && game.score_home! < game.score_away! && styles.scoreLoss,
            ]}>
              {game.score_home}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: 100 },

  // Header
  header: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald },
  liveText: { fontSize: fontSize.xs, color: colors.emerald, fontWeight: "600" },

  // Search
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: fontSize.sm,
    color: colors.text,
  },

  // Player search results
  playerResults: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  playerRowPressed: { backgroundColor: colors.cardHover },
  playerAvatar: { width: 32, height: 32, borderRadius: 16 },
  playerAvatarFallback: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  playerAvatarLetter: { color: colors.emerald, fontSize: 14, fontWeight: "700" },
  playerInfo: { flex: 1 },
  playerName: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  playerTeam: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  playerHasGame: { fontSize: fontSize.xs, color: colors.emerald, fontWeight: "600" },
  playerNoGame: { fontSize: fontSize.xs, color: colors.textDim },

  // Filter chips
  filterRow: { marginBottom: spacing.sm },
  filterContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  chipActive: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
  },
  chipText: { fontSize: fontSize.xs, fontWeight: "600", color: colors.textMuted },
  chipTextActive: { color: colors.black },
  chipDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.emerald },
  chipDotActive: { backgroundColor: colors.black },

  // Section header
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(39,39,42,0.4)",
  },
  sectionLeague: { fontSize: 10, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase" },
  sectionLive: { flexDirection: "row", alignItems: "center", gap: 3 },
  liveDotSmall: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.emerald },
  sectionLiveText: { fontSize: 10, color: colors.emerald, fontWeight: "600" },
  sectionCount: { fontSize: 10, color: colors.textDim, marginLeft: "auto" },

  // Game row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.cardHover },

  status: {
    width: 52,
    fontSize: 10,
    fontWeight: "600",
    color: colors.textMuted,
  },
  statusLive: { color: colors.emerald },

  teams: { flex: 1, gap: 3 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  teamLogo: { width: 16, height: 16 },
  teamLogoFallback: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  teamLogoLetter: { fontSize: 7, fontWeight: "700", color: colors.textMuted },
  teamName: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary },
  score: { fontSize: fontSize.xs, fontWeight: "700", color: colors.textSecondary, minWidth: 20, textAlign: "right" },
  scoreWin: { color: colors.text },
  scoreLoss: { color: colors.textMuted },

  // Empty
  empty: { paddingVertical: 60, alignItems: "center" },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted },
});

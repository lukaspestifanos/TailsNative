import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Haptics from "expo-haptics";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { API_BASE, supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { CloseIcon, ImageIcon, GamesIcon } from "../components/Icons";
import MentionAutocomplete, { extractMentionQuery } from "../components/MentionAutocomplete";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "Compose">;

type GameItem = {
  id: string;
  league: string;
  home_team: string;
  away_team: string;
  start_time: string;
  status: string | null;
  home_logo?: string;
  away_logo?: string;
};

const MMA_LEAGUES = ["UFC", "PFL", "Bellator"];
const SOCCER_LEAGUES = ["Premier League", "Bundesliga", "La Liga", "Serie A", "Ligue 1", "UCL", "Europa League", "World Cup", "WCQ UEFA", "Nations League", "Copa America", "MLS", "Friendlies"];
const TENNIS_LEAGUES = ["ATP", "WTA"];
const EXTENDED_LEAGUES = new Set([...SOCCER_LEAGUES, "NCAAM"]);


function formatGameTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatStatus(game: GameItem): string {
  if (game.status === "live") return "LIVE";
  if (game.status === "final") return "Final";
  return formatGameTime(game.start_time);
}

export default function ComposeScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { user, profile } = useAuth();

  // Content
  const [content, setContent] = useState("");
  const [mediaUris, setMediaUris] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Game picker
  const [selectedGame, setSelectedGame] = useState<GameItem | null>(null);
  const [showGamePicker, setShowGamePicker] = useState(false);
  const [games, setGames] = useState<GameItem[]>([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gameSearch, setGameSearch] = useState("");

  const textRef = useRef<TextInput>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const charCount = content.length;
  const MAX_CHARS = 500;

  // Prefetch games immediately so picker is instant
  useEffect(() => { fetchGames(); }, []);

  // Load game from nav params if provided
  useEffect(() => {
    if (route.params?.gameId && games.length > 0) {
      const game = games.find((g) => g.id === route.params!.gameId);
      if (game) setSelectedGame(game);
    }
  }, [route.params?.gameId, games]);

  // Prefetch games on mount — API + extended ESPN for sparse sports
  const fetchGames = useCallback(async () => {
    if (games.length > 0) return;
    setGamesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/games/today?_t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      const apiGames: GameItem[] = [
        ...(data.games || []).map((g: any) => ({ ...g, league: g.league || "NBA" })),
        ...(data.mlb || []),
        ...(data.ncaam || []),
        ...(data.mma || []),
        ...(data.soccer || []),
        ...(data.tennis || []),
      ];
      const apiIds = new Set(apiGames.map((g) => g.id));

      // Extended ESPN fetch for soccer + NCAAM (72h back, 7 days forward)
      const makeDateStr = (offset: number) => {
        const d = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
        return d.toISOString().slice(0, 10).replace(/-/g, "");
      };
      const extDates: string[] = [];
      for (let i = -3; i <= 7; i++) extDates.push(makeDateStr(i));

      const extEndpoints = [
        { path: "soccer/eng.1", league: "Premier League" },
        { path: "soccer/esp.1", league: "La Liga" },
        { path: "soccer/ger.1", league: "Bundesliga" },
        { path: "soccer/ita.1", league: "Serie A" },
        { path: "soccer/fra.1", league: "Ligue 1" },
        { path: "soccer/uefa.champions", league: "UCL" },
        { path: "soccer/uefa.europa", league: "Europa League" },
        { path: "soccer/fifa.world", league: "World Cup" },
        { path: "soccer/conmebol.america", league: "Copa America" },
        { path: "soccer/usa.1", league: "MLS" },
        { path: "soccer/fifa.friendly", league: "Friendlies" },
        { path: "soccer/fifa.worldq.uefa", league: "WCQ UEFA" },
        { path: "soccer/uefa.nations", league: "Nations League" },
        { path: "basketball/mens-college-basketball", league: "NCAAM" },
      ];

      const seenIds = new Set<string>();
      const cutoff72h = Date.now() - 72 * 60 * 60 * 1000;
      const espnGames: GameItem[] = [];

      await Promise.all(
        extEndpoints.flatMap(({ path, league: lg }) =>
          extDates.map(async (dateStr) => {
            try {
              const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dateStr}`);
              if (!r.ok) return;
              const d = await r.json();
              for (const event of d.events || []) {
                const comp = event.competitions?.[0];
                const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
                const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
                const isSoccer = SOCCER_LEAGUES.includes(lg);
                const id = isSoccer
                  ? `soccer_${lg.toLowerCase().replace(/\s+/g, "_")}_${event.id}`
                  : `${lg.toLowerCase()}_espn_${event.id}`;
                if (apiIds.has(id) || seenIds.has(id)) continue;
                seenIds.add(id);
                const isCompleted = event.status?.type?.completed === true;
                const eventTime = new Date(event.date || 0).getTime();
                if (isCompleted && eventTime < cutoff72h) continue;
                espnGames.push({
                  id,
                  league: lg,
                  home_team: home?.team?.displayName || "TBD",
                  away_team: away?.team?.displayName || "TBD",
                  start_time: event.date || "",
                  status: isCompleted ? "final" : event.status?.type?.state === "in" ? "live" : "scheduled",
                  home_logo: home?.team?.logo || undefined,
                  away_logo: away?.team?.logo || undefined,
                });
              }
            } catch {}
          })
        )
      );

      // Deduplicate — API and ESPN can return the same game with different IDs
      const dedupKey = (g: GameItem) => {
        const day = g.start_time ? g.start_time.slice(0, 10) : "";
        return `${g.league}|${g.home_team}|${g.away_team}|${day}`.toLowerCase();
      };
      const seen = new Set<string>();
      const merged: GameItem[] = [];
      for (const g of [...apiGames, ...espnGames]) {
        const key = dedupKey(g);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(g);
      }
      setGames(merged);
    } catch {}
    setGamesLoading(false);
  }, [games.length]);

  // Pick media from library
  const pickMedia = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 4 - mediaUris.length,
      quality: 0.8,
      exif: false,
    });

    if (!result.canceled) {
      const newUris = result.assets.map((a: any) => a.uri);
      setMediaUris((prev) => [...prev, ...newUris].slice(0, 4));
    }
  }, [mediaUris.length]);

  // Submit post
  const handleSubmit = useCallback(async () => {
    if (!user || submitting) return;
    if (!content.trim() && mediaUris.length === 0) return;

    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let imageUrl: string | null = null;

    // Upload media — convert images to JPEG (browsers can't render HEIC), then upload
    if (mediaUris.length > 0) {
      const urls: string[] = [];
      for (let uri of mediaUris) {
        const fileName = uri.split("/").pop() || `${Date.now()}.jpg`;
        let ext = fileName.split(".").pop()?.toLowerCase() || "jpg";
        const isVideoFile = ext === "mp4" || ext === "mov" || ext === "webm" || ext === "m4v";

        // Convert all images to JPEG so they render on web (HEIC/HEIF don't work in browsers)
        if (!isVideoFile) {
          try {
            const manipulated = await ImageManipulator.manipulateAsync(
              uri,
              [],
              { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
            );
            uri = manipulated.uri;
            ext = "jpg";
          } catch (e) {
            console.warn("[Compose] Image conversion error:", e);
          }
        }

        const mimeType = isVideoFile ? `video/${ext}` : "image/jpeg";
        const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        try {
          const response = await fetch(uri);
          const arrayBuffer = await response.arrayBuffer();

          const { error: uploadErr } = await supabase.storage
            .from("post-media")
            .upload(path, arrayBuffer, { cacheControl: "3600", upsert: false, contentType: mimeType });

          if (uploadErr) {
            console.warn("[Compose] Upload error:", uploadErr.message);
          } else {
            const { data } = supabase.storage.from("post-media").getPublicUrl(path);
            urls.push(data.publicUrl);
          }
        } catch (e) {
          console.warn("[Compose] File read error:", e);
        }
      }
      if (urls.length === 1) imageUrl = urls[0];
      else if (urls.length > 1) imageUrl = JSON.stringify(urls);
    }

    // Insert post
    const { error: insertErr } = await supabase.from("posts").insert({
      user_id: user.id,
      content: content.trim() || "",
      image_url: imageUrl,
      game_id: selectedGame?.id || null,
    });

    if (insertErr) {
      Alert.alert("Error", insertErr.message);
      setSubmitting(false);
      return;
    }

    // Update last_active_at
    await supabase.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("id", user.id);

    setSubmitting(false);
    navigation.goBack();
  }, [content, mediaUris, selectedGame, user, submitting, navigation]);

  // Handle mention selection — replace @partial with @username
  const handleMentionSelect = useCallback((username: string) => {
    const textUpToCursor = content.slice(0, cursorPos);
    const replaced = textUpToCursor.replace(/@[a-zA-Z0-9_-]*$/, `@${username} `);
    const newContent = replaced + content.slice(cursorPos);
    setContent(newContent);
    const newCursor = replaced.length;
    setCursorPos(newCursor);
    // Set selection after state update
    setTimeout(() => {
      textRef.current?.setNativeProps({ selection: { start: newCursor, end: newCursor } });
    }, 50);
  }, [content, cursorPos]);

  // Player-to-team lookup: search ESPN for athlete names, collect their team names
  const [playerTeams, setPlayerTeams] = useState<string[]>([]);
  const playerSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (playerSearchRef.current) clearTimeout(playerSearchRef.current);
    const q = gameSearch.trim().toLowerCase();
    if (!q || q.length < 2) {
      setPlayerTeams([]);
      return;
    }

    // Only search ESPN if the query doesn't already match a team/league directly
    const hasDirectMatch = games.some(
      (g) =>
        g.home_team.toLowerCase().includes(q) ||
        g.away_team.toLowerCase().includes(q) ||
        g.league.toLowerCase().includes(q)
    );
    if (hasDirectMatch) {
      setPlayerTeams([]);
      return;
    }

    playerSearchRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=5&type=player`
        );
        if (!res.ok) return;
        const data = await res.json();
        const teams: string[] = [];
        for (const item of data?.items || []) {
          for (const rel of item?.teamRelationships || []) {
            const teamName = rel?.displayName || rel?.core?.displayName;
            if (teamName) teams.push(teamName.toLowerCase());
          }
        }
        setPlayerTeams([...new Set(teams)]);
      } catch {}
    }, 300);

    return () => {
      if (playerSearchRef.current) clearTimeout(playerSearchRef.current);
    };
  }, [gameSearch, games]);

  // Filtered games for picker — matches team/league name OR player's team
  const filteredGames = useMemo(() => {
    if (!gameSearch.trim()) return games;
    const q = gameSearch.toLowerCase();
    return games.filter((g) =>
      g.home_team.toLowerCase().includes(q) ||
      g.away_team.toLowerCase().includes(q) ||
      g.league.toLowerCase().includes(q) ||
      playerTeams.some(
        (t) => g.home_team.toLowerCase().includes(t) || g.away_team.toLowerCase().includes(t)
      )
    );
  }, [games, gameSearch, playerTeams]);

  // === GAME PICKER VIEW ===
  if (showGamePicker) {
    // Group filtered games by league
    const grouped = filteredGames.reduce<Record<string, GameItem[]>>((acc, g) => {
      (acc[g.league] ??= []).push(g);
      return acc;
    }, {});
    const leagueKeys = Object.keys(grouped);

    return (
      <SafeAreaView style={s.container}>
        <View style={s.pickerHeader}>
          <Pressable onPress={() => { setShowGamePicker(false); setGameSearch(""); }} hitSlop={12}>
            <Text style={s.pickerBack}>Back</Text>
          </Pressable>
          <Text style={s.pickerTitle}>Tag a Game</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Search */}
        <View style={s.pickerSearch}>
          <TextInput
            style={s.pickerSearchInput}
            value={gameSearch}
            onChangeText={setGameSearch}
            placeholder="Search teams or leagues..."
            placeholderTextColor={colors.textDim}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        {/* Games list — grouped by league */}
        {gamesLoading ? (
          <ActivityIndicator color={colors.emerald} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {leagueKeys.length === 0 && (
              <View style={s.emptyGames}><Text style={s.emptyText}>No games found</Text></View>
            )}
            {leagueKeys.map((league) => (
              <View key={league}>
                {/* League header */}
                <View style={s.leagueHeader}>
                  <Text style={s.leagueHeaderText}>{league}</Text>
                  <Text style={s.leagueCount}>{grouped[league].length}</Text>
                </View>

                {/* Game cards */}
                {grouped[league].map((item) => {
                  const isLive = item.status === "live";
                  const isFinal = item.status === "final";
                  const hasScore = (item as any).score_home != null;
                  return (
                    <Pressable
                      key={item.id}
                      style={({ pressed }) => [s.gameCard, pressed && s.gameCardPressed]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedGame(item);
                        setShowGamePicker(false);
                        setGameSearch("");
                      }}
                    >
                      {/* Live indicator */}
                      {isLive && <View style={s.liveDot} />}

                      {/* Away team */}
                      <View style={s.gcTeamCol}>
                        {item.away_logo ? (
                          <Image source={{ uri: item.away_logo }} style={s.gcLogo} contentFit="contain" transition={0} />
                        ) : (
                          <View style={s.gcLogoFallback}><Text style={s.gcLogoLetter}>{item.away_team.split(" ").pop()?.[0]}</Text></View>
                        )}
                        <Text style={s.gcTeamName} numberOfLines={1}>{item.away_team}</Text>
                      </View>

                      {/* Score or time */}
                      <View style={s.gcCenter}>
                        {hasScore ? (
                          <Text style={[s.gcScore, isLive && s.gcScoreLive]}>
                            {(item as any).score_away} - {(item as any).score_home}
                          </Text>
                        ) : (
                          <Text style={s.gcTime}>{formatGameTime(item.start_time)}</Text>
                        )}
                        <Text style={[s.gcStatusLabel, isLive && s.gcStatusLive, isFinal && s.gcStatusFinal]}>
                          {isLive ? "LIVE" : isFinal ? "FINAL" : new Date(item.start_time).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </Text>
                      </View>

                      {/* Home team */}
                      <View style={[s.gcTeamCol, s.gcTeamColRight]}>
                        {item.home_logo ? (
                          <Image source={{ uri: item.home_logo }} style={s.gcLogo} contentFit="contain" transition={0} />
                        ) : (
                          <View style={s.gcLogoFallback}><Text style={s.gcLogoLetter}>{item.home_team.split(" ").pop()?.[0]}</Text></View>
                        )}
                        <Text style={s.gcTeamName} numberOfLines={1}>{item.home_team}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  // === MAIN COMPOSE VIEW ===
  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[s.postBtn, (!content.trim() && mediaUris.length === 0) && s.postBtnDisabled]}
            onPress={handleSubmit}
            disabled={(!content.trim() && mediaUris.length === 0) || submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.black} size="small" />
            ) : (
              <Text style={s.postBtnText}>Post</Text>
            )}
          </Pressable>
        </View>

        {/* Toolbar — at the top, always visible */}
        <View style={s.toolbar}>
          <Pressable style={s.toolBtn} onPress={() => setShowGamePicker(true)}>
            <GamesIcon size={20} color={selectedGame ? colors.emerald : colors.textMuted} />
            <Text style={[s.toolLabel, selectedGame && { color: colors.emerald }]}>Game</Text>
          </Pressable>

          <Pressable style={s.toolBtn} onPress={pickMedia} disabled={mediaUris.length >= 4}>
            <ImageIcon size={20} color={mediaUris.length >= 4 ? colors.textDim : colors.textMuted} />
            <Text style={[s.toolLabel, mediaUris.length >= 4 && { color: colors.textDim }]}>
              Media{mediaUris.length > 0 ? ` (${mediaUris.length}/4)` : ""}
            </Text>
          </Pressable>

          <Text style={[s.toolCharCount, charCount > MAX_CHARS * 0.9 && s.charCountWarn]}>
            {charCount}/{MAX_CHARS}
          </Text>
        </View>

        {/* Scrollable content area */}
        <ScrollView style={s.body} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          {/* Author row */}
          <View style={s.authorRow}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={s.avatar} contentFit="cover" transition={0} />
            ) : (
              <View style={s.avatarFallback}>
                <Text style={s.avatarLetter}>{profile?.username?.[0]?.toUpperCase() || "?"}</Text>
              </View>
            )}
            <Text style={s.authorName}>{profile?.name || profile?.username || "You"}</Text>
          </View>

          {/* Mention autocomplete */}
          <MentionAutocomplete
            text={content}
            cursorPosition={cursorPos}
            onSelect={handleMentionSelect}
          />

          {/* Text input */}
          <TextInput
            ref={textRef}
            style={s.textInput}
            value={content}
            onChangeText={(t) => {
              if (t.length <= MAX_CHARS) setContent(t);
            }}
            onSelectionChange={(e) => setCursorPos(e.nativeEvent.selection.end)}
            placeholder="What's your take?"
            placeholderTextColor={colors.textDim}
            multiline
            autoFocus
            textAlignVertical="top"
          />

          {/* Tagged game */}
          {selectedGame && (
            <View style={s.taggedGame}>
              <View style={s.taggedGameContent}>
                {selectedGame.away_logo && (
                  <Image source={{ uri: selectedGame.away_logo }} style={s.taggedLogo} contentFit="contain" transition={0} />
                )}
                <Text style={s.taggedText} numberOfLines={1}>
                  {selectedGame.away_team} @ {selectedGame.home_team}
                </Text>
                <Text style={s.taggedLeague}>{selectedGame.league}</Text>
              </View>
              <Pressable onPress={() => setSelectedGame(null)} hitSlop={8}>
                <CloseIcon size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          )}

          {/* Media previews */}
          {mediaUris.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.mediaPreviews} contentContainerStyle={s.mediaPreviewsContent}>
              {mediaUris.map((uri, i) => (
                <View key={i} style={s.mediaThumb}>
                  <Image source={{ uri }} style={s.mediaThumbImage} contentFit="cover" />
                  <Pressable style={s.mediaRemove} onPress={() => setMediaUris((prev) => prev.filter((_, j) => j !== i))}>
                    <CloseIcon size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </ScrollView>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancelText: { fontSize: fontSize.md, color: colors.textMuted, fontWeight: "600" },
  postBtn: {
    backgroundColor: colors.emerald,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  postBtnDisabled: { opacity: 0.4 },
  postBtnText: { color: colors.black, fontSize: fontSize.sm, fontWeight: "700" },

  // Body
  body: { flex: 1, paddingHorizontal: spacing.lg },
  authorRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.cardHover, alignItems: "center", justifyContent: "center" },
  avatarLetter: { fontSize: 14, fontWeight: "700", color: colors.emerald },
  authorName: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },

  textInput: {
    fontSize: fontSize.lg,
    color: colors.text,
    lineHeight: 26,
    minHeight: 120,
    paddingTop: spacing.sm,
  },
  charCountWarn: { color: colors.red },

  // Tagged game
  taggedGame: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  taggedGameContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  taggedLogo: { width: 16, height: 16 },
  taggedText: { fontSize: fontSize.xs, color: colors.textSecondary, flex: 1 },
  taggedLeague: { fontSize: 10, color: colors.textDim, fontWeight: "600" },

  // Media previews
  mediaPreviews: { marginTop: spacing.md },
  mediaPreviewsContent: { gap: spacing.sm },
  mediaThumb: { width: 80, height: 80, borderRadius: radius.md, overflow: "hidden", position: "relative" },
  mediaThumbImage: { width: 80, height: 80 },
  mediaRemove: {
    position: "absolute", top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center", justifyContent: "center",
  },

  // Toolbar
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    gap: spacing.xl,
  },
  toolBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  toolLabel: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: "600" },
  toolCharCount: { fontSize: 11, color: colors.textDim, marginLeft: "auto", fontVariant: ["tabular-nums"] as any },

  // Game picker
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerBack: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "600" },
  pickerTitle: { fontSize: fontSize.md, fontWeight: "700", color: colors.text },
  pickerSearch: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  pickerSearchInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: 4,
    paddingBottom: 14,
    fontSize: fontSize.sm,
    color: colors.text,
  },


  // League headers
  leagueHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(39,39,42,0.3)",
  },
  leagueHeaderText: { fontSize: 10, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  leagueCount: { fontSize: 10, color: colors.textDim },

  // Game cards
  gameCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.md,
    marginVertical: 3,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderCurve: "continuous",
    gap: spacing.sm,
  },
  gameCardPressed: { backgroundColor: colors.cardHover, borderColor: colors.emerald },
  liveDot: { position: "absolute", top: 8, left: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald },
  gcTeamCol: { flex: 1, alignItems: "center", gap: 4 },
  gcTeamColRight: {},
  gcLogo: { width: 28, height: 28 },
  gcLogoFallback: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cardHover, alignItems: "center", justifyContent: "center" },
  gcLogoLetter: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
  gcTeamName: { fontSize: 10, fontWeight: "600", color: colors.textSecondary, textAlign: "center" },
  gcCenter: { alignItems: "center", paddingHorizontal: spacing.sm, minWidth: 60 },
  gcScore: { fontSize: fontSize.md, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] as any },
  gcScoreLive: { color: colors.emerald },
  gcTime: { fontSize: fontSize.xs, fontWeight: "600", color: colors.textMuted },
  gcStatusLabel: { fontSize: 9, fontWeight: "600", color: colors.textDim, marginTop: 2, textTransform: "uppercase" },
  gcStatusLive: { color: colors.emerald },
  gcStatusFinal: { color: colors.textDim },

  emptyGames: { paddingVertical: 40, alignItems: "center" },
  emptyText: { fontSize: fontSize.sm, color: colors.textMuted },
});

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  Dimensions,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { timeAgo } from "../lib/formatters";
import { parseImageUrls } from "../lib/parseImageUrls";
import { isVideo } from "../lib/parseImageUrls";
import Svg, { Path, Circle as SvgCircle } from "react-native-svg";
import MentionText from "../components/MentionText";
import PostCard from "../components/PostCard";
import { FeedSkeleton } from "../components/Skeleton";
import { HammerIcon, CommentIcon } from "../components/Icons";
import FloatingComposeButton from "../components/FloatingComposeButton";
import type { Post } from "../lib/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type SearchTab = "top" | "people" | "posts" | "games";

// ─── People Result Row ───

function PersonRow({ profile, onPress }: { profile: any; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [s.personRow, pressed && s.personRowPressed]} onPress={onPress}>
      {profile.avatar_url ? (
        <Image source={{ uri: profile.avatar_url }} style={s.personAvatar} contentFit="cover" transition={0} />
      ) : (
        <View style={s.personAvatarFallback}>
          <Text style={s.personAvatarLetter}>{profile.username?.[0]?.toUpperCase() || "?"}</Text>
        </View>
      )}
      <View style={s.personInfo}>
        <Text style={s.personName} numberOfLines={1}>{profile.name || profile.username}</Text>
        <Text style={s.personUsername}>@{profile.username}</Text>
        {profile.bio ? <Text style={s.personBio} numberOfLines={1}>{profile.bio}</Text> : null}
      </View>
    </Pressable>
  );
}

// ─── Post Result Row ───

function PostRow({ post, onPress }: { post: any; onPress: () => void }) {
  const imageUrls = post.image_url ? parseImageUrls(post.image_url).filter((u: string) => !isVideo(u)) : [];

  return (
    <Pressable style={({ pressed }) => [s.postRow, pressed && s.postRowPressed]} onPress={onPress}>
      <View style={s.postRowLeft}>
        <View style={s.postRowHeader}>
          {post.profiles?.avatar_url ? (
            <Image source={{ uri: post.profiles.avatar_url }} style={s.postRowAvatar} contentFit="cover" transition={0} />
          ) : (
            <View style={s.postRowAvatarFallback}>
              <Text style={s.postRowAvatarLetter}>{post.profiles?.username?.[0]?.toUpperCase() || "?"}</Text>
            </View>
          )}
          <Text style={s.postRowName} numberOfLines={1}>{post.profiles?.name || post.profiles?.username || "user"}</Text>
          <Text style={s.postRowTime}>{timeAgo(post.created_at)}</Text>
        </View>
        {post.content ? <MentionText text={post.content} style={s.postRowContent} numberOfLines={2} /> : null}
        <View style={s.postRowStats}>
          <HammerIcon size={12} color={colors.textDim} />
          <Text style={s.postRowStat}>{post.likes_count || 0}</Text>
          <CommentIcon size={12} color={colors.textDim} />
          <Text style={s.postRowStat}>{post.comments_count || 0}</Text>
        </View>
      </View>
      {imageUrls.length > 0 && (
        <Image source={{ uri: imageUrls[0] }} style={s.postRowThumb} contentFit="cover" transition={100} />
      )}
    </Pressable>
  );
}

// ─── Game Result Row ───

function GameRow({ game, onPress }: { game: any; onPress: () => void }) {
  const isLive = game.status === "live";
  const isFinal = game.status === "final";

  return (
    <Pressable style={({ pressed }) => [s.gameRow, pressed && s.gameRowPressed]} onPress={onPress}>
      <View style={s.gameRowTeams}>
        <View style={s.gameRowTeam}>
          {game.away_logo ? (
            <Image source={{ uri: game.away_logo }} style={s.gameRowLogo} contentFit="contain" transition={0} />
          ) : null}
          <Text style={s.gameRowTeamName} numberOfLines={1}>{game.away_team}</Text>
        </View>
        <Text style={s.gameRowVs}>
          {game.score_away != null ? `${game.score_away} - ${game.score_home}` : "vs"}
        </Text>
        <View style={s.gameRowTeam}>
          {game.home_logo ? (
            <Image source={{ uri: game.home_logo }} style={s.gameRowLogo} contentFit="contain" transition={0} />
          ) : null}
          <Text style={s.gameRowTeamName} numberOfLines={1}>{game.home_team}</Text>
        </View>
      </View>
      <View style={s.gameRowMeta}>
        <Text style={[s.gameRowLeague, isLive && s.gameRowLive]}>{game.league}</Text>
        <Text style={[s.gameRowStatus, isLive && s.gameRowLive]}>
          {isLive ? "LIVE" : isFinal ? "Final" : new Date(game.start_time).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Main Search Screen ───

export default function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user, blockedIds } = useAuth();

  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTab>("top");
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Explore feed (default view)
  const [explorePosts, setExplorePosts] = useState<Post[]>([]);
  const [exploreLoading, setExploreLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stable navigation callback for PostCard
  const onNavigate = useCallback((screen: string, params: any) => {
    navigation.navigate(screen as any, params);
  }, [navigation]);

  // Search results
  const [people, setPeople] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);

  const isSearching = query.trim().length > 0;

  // Fetch trending/explore posts — recent posts sorted by engagement
  const fetchExplore = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("posts")
        .select("id, user_id, content, image_url, created_at, game_id, pick_type, pick_line, pick_odds, pick_sportsbook, pick_result, graded_at, quote_post_id, edited_at, original_content, pinned_at, likes:likes(count), comments:comments(count), tails:tails(count)")
        .order("created_at", { ascending: false })
        .limit(40);

      if (data && data.length > 0) {
        // Enrich with profiles + games
        const userIds = [...new Set(data.map((r: any) => r.user_id))];
        const gameIds = [...new Set(data.map((r: any) => r.game_id).filter(Boolean))];
        const quoteIds = [...new Set(data.filter((r: any) => r.quote_post_id).map((r: any) => r.quote_post_id))];

        const [profilesRes, gamesRes, quotesRes] = await Promise.all([
          supabase.from("profiles").select("id, username, name, avatar_url, last_active_at").in("id", userIds),
          gameIds.length > 0
            ? supabase.from("games").select("id, league, home_team, away_team, start_time, score_home, score_away, status, home_logo, away_logo").in("id", gameIds)
            : Promise.resolve({ data: [] }),
          quoteIds.length > 0
            ? supabase.from("posts").select("id, user_id, content, image_url, created_at").in("id", quoteIds)
            : Promise.resolve({ data: [] }),
        ]);

        const pMap: Record<string, any> = {};
        (profilesRes.data || []).forEach((p: any) => { pMap[p.id] = p; });
        const gMap: Record<string, any> = {};
        (gamesRes.data || []).forEach((g: any) => { gMap[g.id] = g; });

        const qpMap: Record<string, any> = {};
        const quotePosts = quotesRes.data || [];
        if (quotePosts.length > 0) {
          const qpUserIds = [...new Set(quotePosts.map((qp: any) => qp.user_id).filter((id: string) => !pMap[id]))];
          if (qpUserIds.length > 0) {
            const { data: qpProfiles } = await supabase.from("profiles").select("id, username, name, avatar_url, last_active_at").in("id", qpUserIds);
            (qpProfiles || []).forEach((p: any) => { pMap[p.id] = p; });
          }
          quotePosts.forEach((qp: any) => {
            qpMap[qp.id] = { ...qp, profiles: pMap[qp.user_id] ? { username: pMap[qp.user_id].username, name: pMap[qp.user_id].name, avatar_url: pMap[qp.user_id].avatar_url, last_active_at: pMap[qp.user_id].last_active_at } : null };
          });
        }

        const enriched = data
          .map((r: any) => ({
            ...r,
            likes_count: r.likes?.[0]?.count ?? 0,
            comments_count: r.comments?.[0]?.count ?? 0,
            tails_count: r.tails?.[0]?.count ?? 0,
            profiles: pMap[r.user_id] ? { username: pMap[r.user_id].username, name: pMap[r.user_id].name, avatar_url: pMap[r.user_id].avatar_url, last_active_at: pMap[r.user_id].last_active_at } : null,
            games: r.game_id ? gMap[r.game_id] || null : null,
            parlay: null,
            quote_post: r.quote_post_id ? qpMap[r.quote_post_id] || null : null,
          }))
          .sort((a: any, b: any) => (b.likes_count + b.comments_count + b.tails_count) - (a.likes_count + a.comments_count + a.tails_count));
        setExplorePosts(enriched);
      }
    } catch {}
    setExploreLoading(false);
  }, []);

  useEffect(() => { fetchExplore(); }, [fetchExplore]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchExplore();
    setRefreshing(false);
  }, [fetchExplore]);

  // Debounced search
  useEffect(() => {
    const raw = query.trim();
    if (!raw) {
      setPeople([]);
      setPosts([]);
      setGames([]);
      setSearching(false);
      return;
    }

    // Strip leading @ so "@pat" matches username "pat"
    const q = raw.replace(/^@/, "");
    const isAtSearch = raw.startsWith("@");

    if (isAtSearch) setActiveTab("people");
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        // Search people, posts, and games in parallel
        // If query starts with @, prioritize exact username match
        const [peopleRes, postsRes, gamesRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("id, username, name, avatar_url, bio")
            .or(isAtSearch ? `username.ilike.${q}%` : `username.ilike.%${q}%,name.ilike.%${q}%`)
            .limit(20),
          isAtSearch
            ? Promise.resolve({ data: [] })
            : supabase
                .from("posts")
                .select("id, user_id, content, image_url, created_at, likes:likes(count), comments:comments(count)")
                .ilike("content", `%${q}%`)
                .order("created_at", { ascending: false })
                .limit(20),
          isAtSearch
            ? Promise.resolve({ data: [] })
            : supabase
                .from("games")
                .select("id, league, home_team, away_team, start_time, score_home, score_away, status, home_logo, away_logo")
                .or(`home_team.ilike.%${q}%,away_team.ilike.%${q}%,league.ilike.%${q}%`)
                .order("start_time", { ascending: false })
                .limit(20),
        ]);

        setPeople((peopleRes.data || []).filter((p: any) => !blockedIds.has(p.id)));

        // Enrich posts with profiles
        const postRows = postsRes.data || [];
        if (postRows.length > 0) {
          const userIds = [...new Set(postRows.map((p: any) => p.user_id))];
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, username, name, avatar_url")
            .in("id", userIds);
          const pMap: Record<string, any> = {};
          (profiles || []).forEach((p: any) => { pMap[p.id] = p; });
          setPosts(postRows.map((p: any) => ({
            ...p,
            likes_count: p.likes?.[0]?.count ?? 0,
            comments_count: p.comments?.[0]?.count ?? 0,
            profiles: pMap[p.user_id] ? { username: pMap[p.user_id].username, name: pMap[p.user_id].name, avatar_url: pMap[p.user_id].avatar_url } : null,
          })));
        } else {
          setPosts([]);
        }

        setGames(gamesRes.data || []);
      } catch {}
      setSearching(false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Tab filter chips
  const TABS: { key: SearchTab; label: string }[] = [
    { key: "top", label: "Top" },
    { key: "people", label: "People" },
    { key: "posts", label: "Posts" },
    { key: "games", label: "Games" },
  ];

  // Combined "Top" results — a few of each
  const topResults = useMemo(() => {
    const items: { type: string; data: any }[] = [];
    people.slice(0, 3).forEach((p) => items.push({ type: "person", data: p }));
    posts.slice(0, 5).forEach((p) => items.push({ type: "post", data: p }));
    games.slice(0, 3).forEach((g) => items.push({ type: "game", data: g }));
    return items;
  }, [people, posts, games]);

  // Render search results based on active tab
  const renderSearchResults = () => {
    if (searching && people.length === 0 && posts.length === 0 && games.length === 0) {
      return (
        <View style={s.emptyState}>
          <ActivityIndicator color={colors.emerald} />
        </View>
      );
    }

    if (!searching && people.length === 0 && posts.length === 0 && games.length === 0) {
      return (
        <View style={s.emptyState}>
          <Text style={s.emptyText}>No results for "{query}"</Text>
        </View>
      );
    }

    if (activeTab === "people") {
      return (
        <FlatList
          key="search-people"
          data={people}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PersonRow profile={item} onPress={() => navigation.push("UserProfile", { username: item.username })} />
          )}
        />
      );
    }

    if (activeTab === "posts") {
      return (
        <FlatList
          key="search-posts"
          data={posts}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PostRow post={item} onPress={() => navigation.push("PostDetail", { postId: item.id })} />
          )}
        />
      );
    }

    if (activeTab === "games") {
      return (
        <FlatList
          key="search-games"
          data={games}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <GameRow game={item} onPress={() => navigation.push("GameDetail", { gameId: item.id })} />
          )}
        />
      );
    }

    // Top — mixed results
    return (
      <FlatList
        key="search-top"
        data={topResults}
        keyExtractor={(item, i) => `${item.type}-${item.data.id}-${i}`}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          if (item.type === "person") {
            return <PersonRow profile={item.data} onPress={() => navigation.push("UserProfile", { username: item.data.username })} />;
          }
          if (item.type === "post") {
            return <PostRow post={item.data} onPress={() => navigation.push("PostDetail", { postId: item.data.id })} />;
          }
          return <GameRow game={item.data} onPress={() => navigation.push("GameDetail", { gameId: item.data.id })} />;
        }}
      />
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Search bar */}
      <View style={s.searchBarWrap}>
        <View style={s.searchBar}>
          <SearchBarIcon />
          <TextInput
            ref={inputRef}
            style={s.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search people, posts, games..."
            placeholderTextColor={colors.textDim}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        {isSearching && (
          <Pressable onPress={() => { setQuery(""); inputRef.current?.blur(); }} hitSlop={8}>
            <Text style={s.cancelBtn}>Cancel</Text>
          </Pressable>
        )}
      </View>

      {/* Tab chips — only when searching */}
      {isSearching && (
        <View style={s.tabRow}>
          {TABS.map((tab) => (
            <Pressable
              key={tab.key}
              style={[s.tabChip, activeTab === tab.key && s.tabChipActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[s.tabChipText, activeTab === tab.key && s.tabChipTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Content */}
      {isSearching ? (
        renderSearchResults()
      ) : (
        // Explore feed — trending posts
        exploreLoading ? (
          <FeedSkeleton />
        ) : (
          <FlatList
            key="explore-feed"
            data={explorePosts}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.emerald} />}
            renderItem={({ item }) => (
              <PostCard post={item} onNavigate={onNavigate} userId={user?.id ?? null} />
            )}
            ListHeaderComponent={
              <Text style={s.exploreHeader}>Trending</Text>
            }
          />
        )
      )}
      <FloatingComposeButton />
    </View>
  );
}

function SearchBarIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.textDim} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <SvgCircle cx="11" cy="11" r="8" />
      <Path d="M21 21l-4.35-4.35" />
    </Svg>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Search bar
  searchBarWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    height: 38,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    paddingVertical: 0,
  },
  cancelBtn: {
    fontSize: fontSize.sm,
    color: colors.emerald,
    fontWeight: "600",
  },

  // Tab chips
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabChipActive: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
  },
  tabChipText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  tabChipTextActive: {
    color: colors.black,
  },

  // Explore feed
  exploreHeader: {
    fontSize: fontSize.xl,
    fontWeight: "800",
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  // Person row
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  personRowPressed: {
    backgroundColor: colors.card,
  },
  personAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  personAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.cardHover,
    alignItems: "center",
    justifyContent: "center",
  },
  personAvatarLetter: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.emerald,
  },
  personInfo: {
    flex: 1,
    gap: 2,
  },
  personName: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.text,
  },
  personUsername: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  personBio: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    marginTop: 2,
  },

  // Post row
  postRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  postRowPressed: {
    backgroundColor: colors.card,
  },
  postRowLeft: {
    flex: 1,
    gap: 6,
  },
  postRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  postRowAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  postRowAvatarFallback: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.cardHover,
    alignItems: "center",
    justifyContent: "center",
  },
  postRowAvatarLetter: {
    fontSize: 8,
    fontWeight: "700",
    color: colors.emerald,
  },
  postRowName: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.text,
    flex: 1,
  },
  postRowTime: {
    fontSize: fontSize.xs,
    color: colors.textDim,
  },
  postRowContent: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  postRowStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  postRowStat: {
    fontSize: 10,
    color: colors.textDim,
    marginRight: 6,
  },
  postRowThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
  },

  // Game row
  gameRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  gameRowPressed: {
    backgroundColor: colors.card,
  },
  gameRowTeams: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  gameRowTeam: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  gameRowLogo: {
    width: 20,
    height: 20,
  },
  gameRowTeamName: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.text,
    flex: 1,
  },
  gameRowVs: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    color: colors.textMuted,
    minWidth: 40,
    textAlign: "center",
  },
  gameRowMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  gameRowLeague: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.textDim,
    textTransform: "uppercase",
  },
  gameRowStatus: {
    fontSize: fontSize.xs,
    color: colors.textDim,
  },
  gameRowLive: {
    color: colors.emerald,
  },

  // Empty
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});

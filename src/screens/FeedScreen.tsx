import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { API_BASE, supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import type { Post } from "../lib/types";
import PostCard from "../components/PostCard";
import { FeedSkeleton } from "../components/Skeleton";

type FeedTab = "foryou" | "recent" | "tagged" | "trending";

export default function FeedScreen() {
  const [activeTab, setActiveTab] = useState<FeedTab>("foryou");
  const [posts, setPosts] = useState<Post[]>([]);
  const [offset, setOffset] = useState(0);
  const [initialLoad, setInitialLoad] = useState(true); // only true on first ever load
  const loading = initialLoad; // backwards compat alias
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const seenIds = useRef(new Set<string>());
  // Cache per tab so swiping back is instant
  const cache = useRef<Record<FeedTab, Post[]>>({ foryou: [], recent: [], tagged: [], trending: [] });

  // Shared helper: take a Supabase query result, enrich with profiles + games
  const fetchPostsWithProfiles = async (query: any): Promise<Post[]> => {
    const { data: rows, error } = await query;
    if (error || !rows || rows.length === 0) return [];

    const userIds = [...new Set(rows.map((r: any) => r.user_id))];
    const gameIds = [...new Set(rows.map((r: any) => r.game_id).filter(Boolean))];

    const [profilesRes, gamesRes] = await Promise.all([
      supabase.from("profiles").select("id, username, name, avatar_url, last_active_at").in("id", userIds),
      gameIds.length > 0
        ? supabase.from("games").select("id, league, home_team, away_team, start_time, score_home, score_away, status, home_logo, away_logo").in("id", gameIds)
        : Promise.resolve({ data: [] }),
    ]);

    const pMap: Record<string, any> = {};
    (profilesRes.data || []).forEach((p: any) => { pMap[p.id] = p; });
    const gMap: Record<string, any> = {};
    (gamesRes.data || []).forEach((g: any) => { gMap[g.id] = g; });

    return rows.map((r: any) => ({
      ...r,
      likes_count: r.likes?.[0]?.count ?? 0,
      comments_count: r.comments?.[0]?.count ?? 0,
      tails_count: r.tails?.[0]?.count ?? 0,
      profiles: pMap[r.user_id] ? { username: pMap[r.user_id].username, name: pMap[r.user_id].name, avatar_url: pMap[r.user_id].avatar_url, last_active_at: pMap[r.user_id].last_active_at } : null,
      games: r.game_id ? gMap[r.game_id] || null : null,
      parlay: null,
      quote_post: null,
    }));
  };

  // For You — main feed from /api/feed
  const fetchForYou = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    try {
      const res = await fetch(`${API_BASE}/api/feed?offset=${currentOffset}`);
      if (!res.ok) throw new Error("Feed fetch failed");
      const data = await res.json();
      const incoming: Post[] = data.posts || [];

      if (reset) {
        seenIds.current = new Set(incoming.map((p) => p.id));
        setPosts(incoming);
        setOffset(incoming.length);
      } else {
        const newPosts = incoming.filter((p) => !seenIds.current.has(p.id));
        for (const p of newPosts) seenIds.current.add(p.id);
        setPosts((prev) => [...prev, ...newPosts]);
        setOffset((prev) => prev + incoming.length);
      }
      setHasMore(data.hasMore === true);
    } catch {
      if (!reset) setHasMore(false);
    }
  }, [offset]);

  // Recent — posts tagged to games from the last 72 hours
  const fetchRecent = useCallback(async () => {
    try {
      const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const enriched = await fetchPostsWithProfiles(
        supabase.from("posts")
          .select("id, user_id, content, image_url, created_at, game_id, pick_type, pick_line, pick_odds, pick_sportsbook, pick_result, graded_at, parlay_id, quote_post_id, edited_at, original_content, pinned_at, comments:comments(count), likes:likes(count), tails:tails(count)")
          .not("game_id", "is", null)
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(40)
      );
      setPosts(enriched);
    } catch {}
  }, []);

  // Picks — posts with game tags OR media (photos/videos)
  const fetchTagged = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    try {
      const enriched = await fetchPostsWithProfiles(
        supabase.from("posts")
          .select("id, user_id, content, image_url, created_at, game_id, pick_type, pick_line, pick_odds, pick_sportsbook, pick_result, graded_at, parlay_id, quote_post_id, edited_at, original_content, pinned_at, comments:comments(count), likes:likes(count), tails:tails(count)")
          .or("game_id.not.is.null,image_url.not.is.null")
          .order("created_at", { ascending: false })
          .range(currentOffset, currentOffset + 14)
      );

      if (reset) { setPosts(enriched); setOffset(15); }
      else { setPosts((prev) => [...prev, ...enriched]); setOffset((prev) => prev + 15); }
      setHasMore(enriched.length >= 15);
    } catch {}
  }, [offset]);

  // Trending — posts sorted by engagement (likes + comments + tails) in last 24h
  const fetchTrending = useCallback(async () => {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const enriched = await fetchPostsWithProfiles(
        supabase.from("posts")
          .select("id, user_id, content, image_url, created_at, game_id, pick_type, pick_line, pick_odds, pick_sportsbook, pick_result, graded_at, parlay_id, quote_post_id, edited_at, original_content, pinned_at, comments:comments(count), likes:likes(count), tails:tails(count)")
          .gte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .limit(50)
      );

      enriched.sort((a, b) => {
        const scoreA = a.likes_count + a.comments_count * 2 + a.tails_count * 3;
        const scoreB = b.likes_count + b.comments_count * 2 + b.tails_count * 3;
        return scoreB - scoreA;
      });

      setPosts(enriched.slice(0, 30));
    } catch {}
  }, []);

  // Fetch based on active tab
  const fetchTab = useCallback(async (reset = false) => {
    switch (activeTab) {
      case "foryou": return fetchForYou(reset);
      case "recent": return fetchRecent();
      case "tagged": return fetchTagged(reset);
      case "trending": return fetchTrending();
    }
  }, [activeTab, fetchForYou, fetchRecent, fetchTagged, fetchTrending]);

  // Load on mount + tab change
  useEffect(() => {
    setPosts([]);
    setOffset(0);
    setHasMore(true);
    seenIds.current = new Set();
    fetchTab(true).then(() => setInitialLoad(false));
  }, [activeTab]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await fetchTab(true);
    setRefreshing(false);
  }, [fetchTab]);

  const onEndReached = useCallback(async () => {
    if (loadingMore || !hasMore || activeTab === "recent" || activeTab === "trending") return;
    setLoadingMore(true);
    await fetchTab(false);
    setLoadingMore(false);
  }, [loadingMore, hasMore, fetchTab, activeTab]);

  const renderPost = useCallback(
    ({ item }: { item: Post }) => <PostCard post={item} />,
    []
  );

  const keyExtractor = useCallback((item: Post) => item.id, []);

  const TABS: { id: FeedTab; label: string }[] = [
    { id: "foryou", label: "For You" },
    { id: "recent", label: "Recent" },
    { id: "tagged", label: "Picks" },
    { id: "trending", label: "Trending" },
  ];

  const SCREEN_WIDTH = Dimensions.get("window").width;
  const pagerRef = useRef<FlatList>(null);
  const tabIndex = TABS.findIndex((t) => t.id === activeTab);

  const onTabPress = (tab: FeedTab) => {
    const idx = TABS.findIndex((t) => t.id === tab);
    pagerRef.current?.scrollToIndex({ index: idx, animated: true });
    setActiveTab(tab);
  };

  const onPagerScroll = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (idx >= 0 && idx < TABS.length && TABS[idx].id !== activeTab) {
      setActiveTab(TABS[idx].id);
    }
  }, [activeTab]);

  const emptyText = (tab: FeedTab) => {
    switch (tab) {
      case "recent": return "No recent game posts";
      case "tagged": return "No game-tagged posts yet";
      case "trending": return "Nothing trending right now";
      default: return "No posts yet";
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header — logo + tabs */}
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <Image
            source={require("../../assets/logo.png")}
            style={styles.logo}
            contentFit="contain"
          />
          <View style={styles.logoText}>
            <Text style={styles.logoTitle}>Tails</Text>
            <Text style={styles.logoSubtitle}>The Sports Social</Text>
          </View>
        </View>

        <View style={styles.tabs}>
          {TABS.map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => onTabPress(tab.id)}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Swipeable pager */}
      <FlatList
        ref={pagerRef}
        data={TABS}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPagerScroll}
        initialScrollIndex={tabIndex}
        getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
        keyExtractor={(item) => item.id}
        renderItem={({ item: tab }) => (
          <View style={{ width: SCREEN_WIDTH }}>
            {tab.id === activeTab && posts.length === 0 ? (
              <FeedSkeleton />
            ) : (
              <FlatList
                data={tab.id === activeTab ? posts : []}
                renderItem={renderPost}
                keyExtractor={keyExtractor}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    tintColor={colors.emerald}
                  />
                }
                onEndReached={tab.id === activeTab ? onEndReached : undefined}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                  tab.id === activeTab && loadingMore ? (
                    <View style={styles.footerLoader}>
                      <ActivityIndicator color={colors.emerald} size="small" />
                    </View>
                  ) : tab.id === activeTab && !hasMore && posts.length > 0 ? (
                    <View style={styles.footerEnd}>
                      <Text style={styles.footerEndText}>You're all caught up</Text>
                    </View>
                  ) : null
                }
                ListEmptyComponent={
                  tab.id === activeTab ? (
                    <View style={styles.empty}>
                      <Text style={styles.emptyText}>{emptyText(tab.id)}</Text>
                    </View>
                  ) : null
                }
              />
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  logo: { width: 36, height: 36 },
  logoText: { gap: -2 },
  logoTitle: { fontSize: 16, fontWeight: "700", color: colors.emerald, lineHeight: 20 },
  logoSubtitle: { fontSize: 9, color: colors.textMuted, lineHeight: 12 },

  // Tabs
  tabs: {
    flexDirection: "row",
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: colors.emerald,
  },
  tabText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.emerald,
  },

  list: {
    paddingVertical: spacing.xs,
    paddingBottom: 100,
  },
  footerLoader: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },
  footerEnd: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },
  footerEndText: {
    fontSize: fontSize.xs,
    color: colors.textDim,
  },
  empty: {
    paddingVertical: 60,
    alignItems: "center",
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
});

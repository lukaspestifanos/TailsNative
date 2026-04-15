import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import * as Haptics from "expo-haptics";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { API_BASE, supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import type { Post } from "../lib/types";
import PostCard from "../components/PostCard";
import { FeedSkeleton } from "../components/Skeleton";
import FloatingComposeButton from "../components/FloatingComposeButton";
import { setAppReady } from "../lib/appReady";
import { parseImageUrls, isVideo } from "../lib/parseImageUrls";

type FeedTab = "foryou" | "following";

const TABS: { id: FeedTab; label: string }[] = [
  { id: "foryou", label: "For You" },
  { id: "following", label: "Following" },
];

export default function FeedScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // Stable navigation callback — doesn't change reference, so PostCard won't re-render
  const onNavigate = useCallback((screen: string, params: any) => {
    navigation.navigate(screen as any, params);
  }, [navigation]);

  // Bumps when screen regains focus — forces PostCards to re-read interaction cache
  const [focusKey, setFocusKey] = useState(0);
  useFocusEffect(useCallback(() => {
    setFocusKey((k) => k + 1);
  }, []));

  // Tap Feed tab while already on Feed → scroll to top + refresh
  const activeTabRef = useRef<FeedTab>("foryou");
  const fetchTabRef = useRef<((tab: FeedTab, reset?: boolean) => Promise<void>) | null>(null);

  const [activeTab, setActiveTab] = useState<FeedTab>("foryou");
  activeTabRef.current = activeTab;
  const [posts, setPosts] = useState<Post[]>([]);
  const [offset, setOffset] = useState(0);
  const [initialLoad, setInitialLoad] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const seenIds = useRef(new Set<string>());
  const cache = useRef<Record<FeedTab, Post[]>>({ foryou: [], following: [] });
  const listRef = useRef<FlatList>(null);

  const fetchPostsWithProfiles = async (query: any): Promise<Post[]> => {
    const { data: rows, error } = await query;
    if (error || !rows || rows.length === 0) return [];

    const userIds = [...new Set(rows.map((r: any) => r.user_id))];
    const gameIds = [...new Set(rows.map((r: any) => r.game_id).filter(Boolean))];
    const quotePostIds = [...new Set(rows.filter((r: any) => r.quote_post_id).map((r: any) => r.quote_post_id))];

    const [profilesRes, gamesRes, quotePostsRes] = await Promise.all([
      supabase.from("profiles").select("id, username, name, avatar_url, last_active_at").in("id", userIds),
      gameIds.length > 0
        ? supabase.from("games").select("id, league, home_team, away_team, start_time, score_home, score_away, status, home_logo, away_logo").in("id", gameIds)
        : Promise.resolve({ data: [] }),
      quotePostIds.length > 0
        ? supabase.from("posts").select("id, user_id, content, image_url, created_at").in("id", quotePostIds)
        : Promise.resolve({ data: [] }),
    ]);

    const pMap: Record<string, any> = {};
    (profilesRes.data || []).forEach((p: any) => { pMap[p.id] = p; });
    const gMap: Record<string, any> = {};
    (gamesRes.data || []).forEach((g: any) => { gMap[g.id] = g; });

    // Enrich quote posts with profiles
    const qpMap: Record<string, any> = {};
    const quotePosts = quotePostsRes.data || [];
    if (quotePosts.length > 0) {
      const qpUserIds = [...new Set(quotePosts.map((qp: any) => qp.user_id).filter((id: string) => !pMap[id]))];
      if (qpUserIds.length > 0) {
        const { data: qpProfiles } = await supabase.from("profiles").select("id, username, name, avatar_url, last_active_at").in("id", qpUserIds);
        (qpProfiles || []).forEach((p: any) => { pMap[p.id] = p; });
      }
      quotePosts.forEach((qp: any) => {
        qpMap[qp.id] = {
          ...qp,
          profiles: pMap[qp.user_id] ? { username: pMap[qp.user_id].username, name: pMap[qp.user_id].name, avatar_url: pMap[qp.user_id].avatar_url, last_active_at: pMap[qp.user_id].last_active_at } : null,
        };
      });
    }

    return rows.map((r: any) => ({
      ...r,
      likes_count: r.likes?.[0]?.count ?? 0,
      comments_count: r.comments?.[0]?.count ?? 0,
      tails_count: r.tails?.[0]?.count ?? 0,
      profiles: pMap[r.user_id] ? { username: pMap[r.user_id].username, name: pMap[r.user_id].name, avatar_url: pMap[r.user_id].avatar_url, last_active_at: pMap[r.user_id].last_active_at } : null,
      games: r.game_id ? gMap[r.game_id] || null : null,
      parlay: null,
      quote_post: r.quote_post_id ? qpMap[r.quote_post_id] || null : null,
    }));
  };

  const fetchForYou = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    try {
      const res = await fetch(`${API_BASE}/api/feed?offset=${currentOffset}`);
      if (!res.ok) throw new Error("Feed fetch failed");
      const data = await res.json();
      const incoming: Post[] = data.posts || [];

      // Deduplicate within the batch
      const unique: Post[] = [];
      const batchSeen = new Set<string>();
      for (const p of incoming) {
        if (!batchSeen.has(p.id)) { batchSeen.add(p.id); unique.push(p); }
      }

      if (reset) {
        seenIds.current = new Set(unique.map((p) => p.id));
        setPosts(unique);
        cache.current.foryou = unique;
        setOffset(unique.length);
      } else {
        const newPosts = unique.filter((p) => !seenIds.current.has(p.id));
        for (const p of newPosts) seenIds.current.add(p.id);
        setPosts((prev) => { const next = [...prev, ...newPosts]; cache.current.foryou = next; return next; });
        setOffset((prev) => prev + incoming.length);
      }
      setHasMore(data.hasMore === true);
    } catch {
      if (!reset) setHasMore(false);
    }
  }, [offset]);

  const fetchFollowing = useCallback(async (reset = false) => {
    if (!userId) {
      setPosts([]);
      cache.current.following = [];
      return;
    }
    const currentOffset = reset ? 0 : offset;
    try {
      // Get list of users the current user follows
      const { data: followRows } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", userId);

      const followingIds = (followRows || []).map((r: any) => r.following_id);
      if (followingIds.length === 0) {
        setPosts([]);
        cache.current.following = [];
        setHasMore(false);
        return;
      }

      const enriched = await fetchPostsWithProfiles(
        supabase.from("posts")
          .select("id, user_id, content, image_url, created_at, game_id, pick_type, pick_line, pick_odds, pick_sportsbook, pick_result, graded_at, parlay_id, quote_post_id, edited_at, original_content, pinned_at, comments:comments(count), likes:likes(count), tails:tails(count)")
          .in("user_id", followingIds)
          .order("created_at", { ascending: false })
          .range(currentOffset, currentOffset + 14)
      );

      if (reset) {
        setPosts(enriched);
        cache.current.following = enriched;
        setOffset(15);
      } else {
        setPosts((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          const fresh = enriched.filter((p) => !ids.has(p.id));
          const next = [...prev, ...fresh];
          cache.current.following = next;
          return next;
        });
        setOffset((prev) => prev + 15);
      }
      setHasMore(enriched.length >= 15);
    } catch {}
  }, [offset, userId]);

  const fetchTab = useCallback(async (tab: FeedTab, reset = false) => {
    switch (tab) {
      case "foryou": return fetchForYou(reset);
      case "following": return fetchFollowing(reset);
    }
  }, [fetchForYou, fetchFollowing]);

  fetchTabRef.current = fetchTab;

  useEffect(() => {
    const unsubscribe = navigation.addListener("tabPress" as any, () => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setRefreshing(true);
        fetchTabRef.current?.(activeTabRef.current, true).then(() => setRefreshing(false));
      }, 150);
    });
    return unsubscribe;
  }, [navigation]);

  // Load on mount — prefetch first batch of images then signal app ready
  useEffect(() => {
    fetchTab("foryou", true).then(async () => {
      setInitialLoad(false);

      // Prefetch avatars + post images so they're cached before splash dismisses
      try {
        const currentPosts = cache.current.foryou.slice(0, 10);
        const urls: string[] = [];
        for (const p of currentPosts) {
          if (p.profiles?.avatar_url) urls.push(p.profiles.avatar_url);
          if (p.games?.home_logo) urls.push(p.games.home_logo);
          if (p.games?.away_logo) urls.push(p.games.away_logo);
          const imgs = parseImageUrls(p.image_url).filter((u) => !isVideo(u));
          urls.push(...imgs.slice(0, 1)); // first image per post
        }
        if (urls.length > 0) {
          await Promise.allSettled(urls.map((u) => Image.prefetch(u)));
        }
      } catch {}

      setAppReady();
    });
  }, []);

  const switchTab = useCallback((tab: FeedTab) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setOffset(0);
    setHasMore(true);
    seenIds.current = new Set();

    // Use cache if available for instant switch
    const cached = cache.current[tab];
    if (cached.length > 0) {
      setPosts(cached);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    } else {
      setPosts([]);
      setTabLoading(true);
      fetchTab(tab, true).then(() => setTabLoading(false));
    }
  }, [activeTab, fetchTab]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await fetchTab(activeTab, true);
    setRefreshing(false);
  }, [fetchTab, activeTab]);

  const onEndReached = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    await fetchTab(activeTab, false);
    setLoadingMore(false);
  }, [loadingMore, hasMore, fetchTab, activeTab]);

  const renderPost = useCallback(
    ({ item }: { item: Post }) => <PostCard post={item} onNavigate={onNavigate} userId={userId} focusKey={focusKey} />,
    [onNavigate, userId, focusKey]
  );

  const keyExtractor = useCallback((item: Post, index: number) => `${activeTab}_${index}_${item.id}`, [activeTab]);

  if (initialLoad) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <Image source={require("../../assets/logo.png")} style={styles.logo} contentFit="contain" />
            <View style={styles.logoText}>
              <Text style={styles.logoTitle}>Tails</Text>
              <Text style={styles.logoSubtitle}>The Sports Social</Text>
            </View>
          </View>
        </View>
        <FeedSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.logoRow}>
          <Image source={require("../../assets/logo.png")} style={styles.logo} contentFit="contain" />
          <View style={styles.logoText}>
            <Text style={styles.logoTitle}>Tails</Text>
            <Text style={styles.logoSubtitle}>The Sports Social</Text>
          </View>
        </View>

        <View style={styles.tabs}>
          {TABS.map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => switchTab(tab.id)}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={posts}
        renderItem={renderPost}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator color={colors.emerald} size="small" />
            </View>
          ) : !hasMore && posts.length > 0 ? (
            <View style={styles.footerEnd}>
              <Text style={styles.footerEndText}>You're all caught up</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          tabLoading ? (
            <FeedSkeleton />
          ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {activeTab === "following" ? "Follow people to see their posts here" : "No posts yet"}
            </Text>
          </View>
          )
        }
      />
      <FloatingComposeButton />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { borderBottomWidth: 1, borderBottomColor: colors.border },
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
  tabs: { flexDirection: "row" },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: colors.emerald },
  tabText: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textMuted },
  tabTextActive: { color: colors.emerald },
  list: { paddingVertical: spacing.xs, paddingBottom: 100 },
  footerLoader: { paddingVertical: spacing.xxl, alignItems: "center" },
  footerEnd: { paddingVertical: spacing.xxl, alignItems: "center" },
  footerEndText: { fontSize: fontSize.xs, color: colors.textDim },
  empty: { paddingVertical: 60, alignItems: "center" },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted },
});

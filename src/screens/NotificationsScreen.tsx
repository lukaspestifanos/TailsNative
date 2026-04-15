import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { parseImageUrls } from "../lib/parseImageUrls";
import { NotificationsSkeleton } from "../components/Skeleton";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Notif = {
  id: string;
  type: "hammer" | "follow" | "comment" | "tail" | "tail_spin";
  created_at: string;
  actor: { username: string; avatar_url: string | null };
  post_id?: string;
  post_content?: string;
  post_image?: string;
  comment_content?: string;
  quote_content?: string;
};

type FilterType = "all" | "hammer" | "follow" | "comment" | "tail";

const FILTERS: { id: FilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "hammer", label: "Hammers" },
  { id: "comment", label: "Comments" },
  { id: "tail", label: "Tails" },
  { id: "follow", label: "Follows" },
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  const hr = Math.floor(min / 60);
  const d = Math.floor(hr / 24);
  if (d > 6) return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (d > 0) return `${d}d`;
  if (hr > 0) return `${hr}h`;
  if (min > 0) return `${min}m`;
  return "now";
}

function actionText(type: Notif["type"]): string {
  switch (type) {
    case "hammer": return "hammered your post";
    case "follow": return "started following you";
    case "comment": return "commented on your post";
    case "tail": return "tailed your post";
    case "tail_spin": return "tail-spun your post";
  }
}

function typeColor(type: Notif["type"]): string {
  switch (type) {
    case "hammer": return colors.emerald;
    case "follow": return colors.blue;
    case "comment": return colors.yellow;
    case "tail": return colors.emerald;
    case "tail_spin": return colors.emerald;
  }
}

export default function NotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const { session, user, profile, blockedIds } = useAuth();

  const isGuest = !profile?.username;

  const [notifications, setNotifications] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [lastSeen, setLastSeen] = useState("1970-01-01T00:00:00Z");

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    const uid = user.id;

    // Rotate seen timestamps (same pattern as web)
    const prevSeen = await AsyncStorage.getItem(`notif_seen_${uid}`) || "1970-01-01T00:00:00Z";
    await AsyncStorage.setItem(`notif_seen_prev_${uid}`, prevSeen);
    await AsyncStorage.setItem(`notif_seen_${uid}`, new Date().toISOString());
    setLastSeen(prevSeen);

    // Get my posts
    const { data: myPosts } = await supabase
      .from("posts")
      .select("id, content, image_url")
      .eq("user_id", uid);

    const myPostIds = (myPosts || []).map((p: any) => p.id);
    const postMap = new Map((myPosts || []).map((p: any) => [p.id, p]));

    // Parallel fetch all activity on my posts
    const [likesRes, followsRes, commentsRes, tailsRes, tailSpinsRes] = await Promise.all([
      myPostIds.length > 0
        ? supabase.from("likes").select("created_at, user_id, post_id").in("post_id", myPostIds).neq("user_id", uid).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] }),
      supabase.from("follows").select("created_at, follower_id").eq("following_id", uid).neq("follower_id", uid).order("created_at", { ascending: false }).limit(50),
      myPostIds.length > 0
        ? supabase.from("comments").select("id, created_at, user_id, content, post_id").in("post_id", myPostIds).neq("user_id", uid).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] }),
      myPostIds.length > 0
        ? supabase.from("tails").select("created_at, user_id, post_id").in("post_id", myPostIds).neq("user_id", uid).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] }),
      myPostIds.length > 0
        ? supabase.from("posts").select("id, created_at, user_id, content, image_url, quote_post_id").in("quote_post_id", myPostIds).neq("user_id", uid).order("created_at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [] }),
    ]);

    // Batch fetch actor profiles
    const actorIds = new Set<string>();
    for (const r of (likesRes.data || []) as any[]) actorIds.add(r.user_id);
    for (const r of (followsRes.data || []) as any[]) actorIds.add(r.follower_id);
    for (const r of (commentsRes.data || []) as any[]) actorIds.add(r.user_id);
    for (const r of (tailsRes.data || []) as any[]) actorIds.add(r.user_id);
    for (const r of (tailSpinsRes.data || []) as any[]) actorIds.add(r.user_id);

    const profileMap = new Map<string, { username: string; avatar_url: string | null }>();
    if (actorIds.size > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", Array.from(actorIds));
      for (const p of (profiles || []) as any[]) profileMap.set(p.id, { username: p.username, avatar_url: p.avatar_url });
    }

    // Build notification items — skip anything from blocked users
    const items: Notif[] = [];

    for (const like of (likesRes.data || []) as any[]) {
      if (blockedIds.has(like.user_id)) continue;
      const actor = profileMap.get(like.user_id);
      if (!actor) continue;
      const post = postMap.get(like.post_id);
      items.push({ id: `like-${like.post_id}-${like.user_id}`, type: "hammer", created_at: like.created_at, actor, post_id: like.post_id, post_content: post?.content, post_image: post?.image_url });
    }

    for (const follow of (followsRes.data || []) as any[]) {
      if (blockedIds.has(follow.follower_id)) continue;
      const actor = profileMap.get(follow.follower_id);
      if (!actor) continue;
      items.push({ id: `follow-${follow.follower_id}`, type: "follow", created_at: follow.created_at, actor });
    }

    for (const comment of (commentsRes.data || []) as any[]) {
      if (blockedIds.has(comment.user_id)) continue;
      const actor = profileMap.get(comment.user_id);
      if (!actor) continue;
      const post = postMap.get(comment.post_id);
      items.push({ id: `comment-${comment.id}`, type: "comment", created_at: comment.created_at, actor, post_id: comment.post_id, post_content: post?.content, post_image: post?.image_url, comment_content: comment.content });
    }

    for (const tail of (tailsRes.data || []) as any[]) {
      if (blockedIds.has(tail.user_id)) continue;
      const actor = profileMap.get(tail.user_id);
      if (!actor) continue;
      const post = postMap.get(tail.post_id);
      items.push({ id: `tail-${tail.post_id}-${tail.user_id}`, type: "tail", created_at: tail.created_at, actor, post_id: tail.post_id, post_content: post?.content, post_image: post?.image_url });
    }

    for (const spin of (tailSpinsRes.data || []) as any[]) {
      if (blockedIds.has(spin.user_id)) continue;
      const actor = profileMap.get(spin.user_id);
      if (!actor) continue;
      const orig = postMap.get(spin.quote_post_id);
      items.push({ id: `tailspin-${spin.id}`, type: "tail_spin", created_at: spin.created_at, actor, post_id: spin.id, post_content: orig?.content, post_image: orig?.image_url, quote_content: spin.content });
    }

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setNotifications(items);
    setLoading(false);
  }, [user, blockedIds]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await loadNotifications();
    setRefreshing(false);
  }, [loadNotifications]);

  const filtered = filter === "all"
    ? notifications
    : filter === "tail"
      ? notifications.filter((n) => n.type === "tail" || n.type === "tail_spin")
      : notifications.filter((n) => n.type === filter);

  const onNotifPress = (n: Notif) => {
    if (n.type === "follow") {
      navigation.navigate("UserProfile", { username: n.actor.username });
    } else if (n.post_id) {
      navigation.navigate("PostDetail", { postId: n.post_id });
    }
  };

  // Sign-in prompt for guests / unauthenticated
  if (!session || isGuest) {
    return (
      <SafeAreaView style={st.container} edges={["top"]}>
        <View style={st.header}><Text style={st.headerTitle}>Notifications</Text></View>
        <View style={st.signInPrompt}>
          <View style={st.signInIconWrap}>
            <Text style={st.signInIcon}>!</Text>
          </View>
          <Text style={st.signInTitle}>Notifications</Text>
          <Text style={st.signInSubtitle}>
            Sign in to see when people hammer, tail, comment on your posts, or follow you.
          </Text>
          <Pressable
            style={({ pressed }) => [st.signInBtn, pressed && st.signInBtnPressed]}
            onPress={() => navigation.navigate("Login")}
          >
            <Text style={st.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={st.container} edges={["top"]}>
        <View style={st.header}><Text style={st.headerTitle}>Notifications</Text></View>
        <NotificationsSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.container} edges={["top"]}>
      <View style={st.header}>
        <Text style={st.headerTitle}>Notifications</Text>
      </View>

      {/* Filter chips */}
      <View style={st.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterContent}>
          {FILTERS.map((f) => (
            <Pressable key={f.id} onPress={() => setFilter(f.id)} style={[st.chip, filter === f.id && st.chipActive]}>
              <Text style={[st.chipText, filter === f.id && st.chipTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
        renderItem={({ item: n }) => {
          const isNew = new Date(n.created_at) > new Date(lastSeen);
          const imageUrls = n.post_image ? parseImageUrls(n.post_image) : [];
          const thumb = imageUrls.length > 0 ? imageUrls[0] : null;

          return (
            <Pressable
              style={({ pressed }) => [st.notifRow, isNew && st.notifRowNew, pressed && st.notifRowPressed]}
              onPress={() => onNotifPress(n)}
            >
              {/* Avatar with type badge */}
              <View style={st.avatarWrap}>
                {n.actor.avatar_url ? (
                  <Image source={{ uri: n.actor.avatar_url }} style={st.avatar} contentFit="cover" transition={0} />
                ) : (
                  <View style={st.avatarFb}><Text style={st.avatarLtr}>{n.actor.username[0]?.toUpperCase()}</Text></View>
                )}
                <View style={[st.typeBadge, { backgroundColor: typeColor(n.type) }]}>
                  <Text style={st.typeBadgeIcon}>
                    {n.type === "hammer" ? "H" : n.type === "follow" ? "F" : n.type === "comment" ? "C" : "T"}
                  </Text>
                </View>
              </View>

              {/* Content */}
              <View style={st.notifContent}>
                <Text style={st.notifText} numberOfLines={2}>
                  <Text style={st.notifUsername}>{n.actor.username}</Text>
                  {" "}{actionText(n.type)}
                </Text>

                {n.comment_content && <Text style={st.notifPreview} numberOfLines={1}>{n.comment_content}</Text>}
                {n.quote_content && <Text style={st.notifPreview} numberOfLines={1}>"{n.quote_content}"</Text>}
                {n.post_content && !n.comment_content && !n.quote_content && (
                  <Text style={st.notifPostPreview} numberOfLines={1}>{n.post_content}</Text>
                )}

                <Text style={st.notifTime}>{timeAgo(n.created_at)}</Text>
              </View>

              {/* Post thumbnail */}
              {thumb && <Image source={{ uri: thumb }} style={st.notifThumb} contentFit="cover" transition={0} />}

              {/* New dot */}
              {isNew && <View style={st.newDot} />}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={st.empty}>
            <Text style={st.emptyTitle}>No notifications yet</Text>
            <Text style={st.emptySub}>When people interact with your posts, you'll see it here</Text>
          </View>
        }
        contentContainerStyle={st.list}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: 100 },

  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text },

  filterRow: { borderBottomWidth: 1, borderBottomColor: colors.border },
  filterContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  chip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  chipText: { fontSize: fontSize.xs, fontWeight: "600", color: colors.textMuted },
  chipTextActive: { color: colors.black },

  notifRow: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  notifRowNew: { backgroundColor: "rgba(16,185,129,0.04)" },
  notifRowPressed: { backgroundColor: colors.cardHover },

  avatarWrap: { position: "relative" },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFb: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cardHover, alignItems: "center", justifyContent: "center" },
  avatarLtr: { fontSize: 16, fontWeight: "700", color: colors.emerald },
  typeBadge: {
    position: "absolute", bottom: -2, right: -2,
    width: 16, height: 16, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.bg,
  },
  typeBadgeIcon: { fontSize: 7, fontWeight: "900", color: colors.black },

  notifContent: { flex: 1, gap: 2 },
  notifText: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 18 },
  notifUsername: { fontWeight: "700", color: colors.text },
  notifPreview: { fontSize: fontSize.xs, color: colors.emerald, lineHeight: 16 },
  notifPostPreview: { fontSize: fontSize.xs, color: colors.textDim, lineHeight: 16 },
  notifTime: { fontSize: 10, color: colors.textDim, marginTop: 2 },

  notifThumb: { width: 40, height: 40, borderRadius: radius.sm },
  newDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald, marginTop: 6 },

  empty: { paddingVertical: 60, alignItems: "center", gap: spacing.sm },
  emptyTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.textMuted },
  emptySub: { fontSize: fontSize.sm, color: colors.textDim, textAlign: "center", paddingHorizontal: spacing.xxl },

  // Sign-in prompt
  signInPrompt: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxl + 8,
  },
  signInIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.emeraldBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  signInIcon: { fontSize: 24, fontWeight: "800", color: colors.emerald },
  signInTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  signInSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  signInBtn: {
    backgroundColor: colors.emerald,
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: radius.lg,
  },
  signInBtnPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  signInBtnText: { color: colors.black, fontSize: fontSize.md, fontWeight: "700" },
});

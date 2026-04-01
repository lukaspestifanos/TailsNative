import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { timeAgo } from "../lib/formatters";
import type { Post } from "../lib/types";
import PostCard from "../components/PostCard";

type Route = RouteProp<RootStackParamList, "UserProfile">;
type Nav = NativeStackNavigationProp<RootStackParamList>;
type ProfileTab = "all" | "posts" | "replies" | "hammers" | "tails";

type ProfileData = {
  id: string;
  username: string;
  name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
  last_active_at: string | null;
};

type Reply = {
  id: string;
  content: string;
  gif_url: string | null;
  created_at: string;
  post_id: string;
  post_content: string | null;
  post_author: { username: string; name: string | null; avatar_url: string | null } | null;
};

// Activity ring — emerald if active <12h, yellow <48h, grey otherwise
function getActivityRingColor(lastActive: string | null): string {
  if (!lastActive) return colors.textDim;
  const elapsed = Date.now() - new Date(lastActive).getTime();
  if (elapsed <= 12 * 60 * 60 * 1000) return colors.emerald;
  if (elapsed <= 48 * 60 * 60 * 1000) return "#eab308"; // yellow-500
  return colors.textDim;
}

function getActivityText(lastActive: string | null): { text: string; color: string } {
  if (!lastActive) return { text: "Inactive", color: colors.textDim };
  const elapsed = Date.now() - new Date(lastActive).getTime();
  const mins = Math.floor(elapsed / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (mins < 5) return { text: "Just posted", color: colors.emerald };
  if (mins < 60) return { text: `Posted ${mins}m ago`, color: colors.emerald };
  if (hours < 12) return { text: `Posted ${hours}h ago`, color: colors.emerald };
  if (hours < 48) return { text: `Last post ${hours}h ago`, color: "#eab308" };
  if (days < 7) return { text: `Last post ${days}d ago`, color: colors.textDim };
  return { text: "Inactive", color: colors.textDim };
}

export default function UserProfileScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [likedPosts, setLikedPosts] = useState<Post[]>([]);
  const [tailedPosts, setTailedPosts] = useState<Post[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const [activeTab, setActiveTab] = useState<ProfileTab>("all");

  // Enriches post rows with profiles + games
  const enrichPosts = async (rows: any[], orderedIds?: string[]): Promise<Post[]> => {
    if (!rows.length) return [];
    const userIds = [...new Set(rows.map((r: any) => r.user_id))];
    const gameIds = [...new Set(rows.filter((r: any) => r.game_id).map((r: any) => r.game_id))];

    const [profilesRes, gamesRes] = await Promise.all([
      supabase.from("profiles").select("id, username, name, avatar_url").in("id", userIds),
      gameIds.length > 0
        ? supabase.from("games").select("id, league, home_team, away_team, start_time, score_home, score_away, status, home_logo, away_logo").in("id", gameIds)
        : Promise.resolve({ data: [] }),
    ]);

    const pMap: Record<string, any> = {};
    (profilesRes.data || []).forEach((p: any) => { pMap[p.id] = p; });
    const gMap: Record<string, any> = {};
    (gamesRes.data || []).forEach((g: any) => { gMap[g.id] = g; });

    const postMap: Record<string, Post> = {};
    rows.forEach((row: any) => {
      postMap[row.id] = {
        ...row,
        likes_count: row.likes?.[0]?.count ?? 0,
        comments_count: row.comments?.[0]?.count ?? 0,
        tails_count: row.tails?.[0]?.count ?? 0,
        profiles: pMap[row.user_id] ? { username: pMap[row.user_id].username, name: pMap[row.user_id].name, avatar_url: pMap[row.user_id].avatar_url, last_active_at: null } : null,
        games: row.game_id ? gMap[row.game_id] || null : null,
        parlay: null,
        quote_post: null,
      };
    });

    if (orderedIds) return orderedIds.map((id) => postMap[id]).filter(Boolean);
    return rows.map((r: any) => postMap[r.id]);
  };

  const fetchProfile = useCallback(async () => {
    const username = params.username;

    // Profile
    const { data: p } = await supabase
      .from("profiles")
      .select("id, username, name, bio, avatar_url, created_at, last_active_at")
      .eq("username", username)
      .maybeSingle();

    if (!p) { setLoading(false); return; }

    // Backfill last_active_at
    if (!p.last_active_at) {
      const { data: latest } = await supabase.from("posts").select("created_at").eq("user_id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (latest) p.last_active_at = latest.created_at;
    }

    setProfile(p);

    // All data in parallel
    const [followersRes, followingRes, followCheck, postRows, likeRows, tailRows, commentRows] = await Promise.all([
      supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", p.id),
      supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", p.id),
      user && user.id !== p.id
        ? supabase.from("follows").select("follower_id").eq("follower_id", user.id).eq("following_id", p.id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("posts").select("id, user_id, content, image_url, created_at, pinned_at, game_id, pick_type, pick_line, pick_odds, pick_sportsbook, pick_result, graded_at, parlay_id, quote_post_id, edited_at, original_content, comments:comments(count), likes:likes(count), tails:tails(count)").eq("user_id", p.id).order("created_at", { ascending: false }),
      supabase.from("likes").select("post_id").eq("user_id", p.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("tails").select("post_id").eq("user_id", p.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("comments").select("id, content, gif_url, created_at, post_id").eq("user_id", p.id).order("created_at", { ascending: false }).limit(50),
    ]);

    setFollowers(followersRes.count ?? 0);
    setFollowing(followingRes.count ?? 0);
    if (followCheck.data) setIsFollowing(true);

    // Own posts
    const ownPosts = await enrichPosts(postRows.data || []);
    setPosts(ownPosts);

    // Liked posts
    const likePostIds = (likeRows.data || []).map((l: any) => l.post_id);
    if (likePostIds.length > 0) {
      const { data: likedRows } = await supabase.from("posts").select("id, user_id, content, image_url, created_at, game_id, pick_type, pick_line, pick_odds, pick_sportsbook, pick_result, graded_at, parlay_id, quote_post_id, edited_at, original_content, pinned_at, comments:comments(count), likes:likes(count), tails:tails(count)").in("id", likePostIds);
      setLikedPosts(await enrichPosts(likedRows || [], likePostIds));
    }

    // Tailed posts
    const tailPostIds = (tailRows.data || []).map((t: any) => t.post_id);
    if (tailPostIds.length > 0) {
      const { data: tailedRows } = await supabase.from("posts").select("id, user_id, content, image_url, created_at, game_id, pick_type, pick_line, pick_odds, pick_sportsbook, pick_result, graded_at, parlay_id, quote_post_id, edited_at, original_content, pinned_at, comments:comments(count), likes:likes(count), tails:tails(count)").in("id", tailPostIds);
      setTailedPosts(await enrichPosts(tailedRows || [], tailPostIds));
    }

    // Replies
    const userComments = commentRows.data || [];
    if (userComments.length > 0) {
      const commentPostIds = [...new Set(userComments.map((c: any) => c.post_id))];
      const { data: commentPosts } = await supabase.from("posts").select("id, content, image_url, user_id").in("id", commentPostIds);
      const cpMap: Record<string, any> = {};
      if (commentPosts) {
        const cpUserIds = [...new Set(commentPosts.map((cp: any) => cp.user_id))];
        const { data: cpProfiles } = await supabase.from("profiles").select("id, username, name, avatar_url").in("id", cpUserIds);
        const cpPMap: Record<string, any> = {};
        (cpProfiles || []).forEach((p: any) => { cpPMap[p.id] = p; });
        commentPosts.forEach((cp: any) => { cpMap[cp.id] = { ...cp, profiles: cpPMap[cp.user_id] || null }; });
      }

      setReplies(userComments.map((c: any) => {
        const orig = cpMap[c.post_id];
        return {
          id: c.id, content: c.content, gif_url: c.gif_url, created_at: c.created_at,
          post_id: c.post_id, post_content: orig?.content || null,
          post_author: orig?.profiles ? { username: orig.profiles.username, name: orig.profiles.name, avatar_url: orig.profiles.avatar_url } : null,
        };
      }));
    }

    setLoading(false);
  }, [params.username, user]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await fetchProfile();
    setRefreshing(false);
  }, [fetchProfile]);

  const toggleFollow = useCallback(async () => {
    if (!user || !profile || user.id === profile.id) return;
    setFollowBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (isFollowing) {
      await supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", profile.id);
      setIsFollowing(false);
      setFollowers((c) => Math.max(0, c - 1));
    } else {
      await supabase.from("follows").insert({ follower_id: user.id, following_id: profile.id });
      setIsFollowing(true);
      setFollowers((c) => c + 1);
    }
    setFollowBusy(false);
  }, [user, profile, isFollowing]);

  // Stats
  const stats = useMemo(() => {
    const picks = posts.filter((p) => p.game_id && p.pick_type);
    const wins = picks.filter((p) => p.pick_result === "win").length;
    const losses = picks.filter((p) => p.pick_result === "loss").length;
    const total = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    return { wins, losses, winRate, total };
  }, [posts]);

  // Filtered posts by tab
  const filteredPosts = useMemo(() => {
    if (activeTab === "replies") return [];
    if (activeTab === "hammers") return likedPosts;
    if (activeTab === "tails") return tailedPosts;
    // "all" and "posts" — pinned first
    const pinned = posts.filter((p) => p.pinned_at).sort((a, b) => new Date(a.pinned_at!).getTime() - new Date(b.pinned_at!).getTime());
    const pinnedIds = new Set(pinned.map((p) => p.id));
    const rest = posts.filter((p) => !pinnedIds.has(p.id));
    return [...pinned, ...rest];
  }, [posts, activeTab, likedPosts, tailedPosts]);

  const isMe = user && profile && user.id === profile.id;
  const ringColor = profile ? getActivityRingColor(profile.last_active_at) : colors.textDim;
  const activity = profile ? getActivityText(profile.last_active_at) : null;

  const TABS: { id: ProfileTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "posts", label: "Posts" },
    { id: "replies", label: "Replies" },
    { id: "hammers", label: "Hammers" },
    { id: "tails", label: "Tails" },
  ];

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.emerald} style={{ marginTop: 60 }} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundTitle}>User not found</Text>
        </View>
      </View>
    );
  }

  const ProfileHeader = () => (
    <View>
      {/* Avatar + info */}
      <View style={styles.headerSection}>
        <View style={styles.avatarCol}>
          <View style={[styles.avatarRing, { borderColor: ringColor }]}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarLetter}>{profile.username[0].toUpperCase()}</Text>
              </View>
            )}
          </View>
          {activity && <Text style={[styles.activityText, { color: activity.color }]}>{activity.text}</Text>}
        </View>

        <View style={styles.infoCol}>
          <View style={styles.nameRow}>
            <Text style={styles.displayName}>{profile.name || profile.username}</Text>
            {stats.winRate >= 55 && stats.total >= 5 && (
              <View style={styles.winBadge}>
                <Text style={styles.winBadgeText}>{stats.winRate}% W</Text>
              </View>
            )}
          </View>
          <Text style={styles.username}>@{profile.username}</Text>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <Text style={styles.stat}><Text style={styles.statBold}>{posts.length}</Text> posts</Text>
            <Text style={styles.stat}><Text style={styles.statBold}>{followers}</Text> followers</Text>
            <Text style={styles.stat}><Text style={styles.statBold}>{following}</Text> following</Text>
          </View>

          {/* Record */}
          {(stats.wins > 0 || stats.losses > 0) && (
            <View style={styles.recordRow}>
              <Text style={styles.recordWin}>{stats.wins}W</Text>
              <Text style={styles.recordDash}> - </Text>
              <Text style={styles.recordLoss}>{stats.losses}L</Text>
            </View>
          )}
        </View>
      </View>

      {/* Bio */}
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      {/* Follow button */}
      {!isMe && user && (
        <View style={styles.followRow}>
          <Pressable
            onPress={toggleFollow}
            disabled={followBusy}
            style={[styles.followBtn, isFollowing && styles.followBtnFollowing]}
          >
            <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextFollowing]}>
              {isFollowing ? "Following" : "Follow"}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabs}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => setActiveTab(tab.id)}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
          >
            <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  // Reply card
  const renderReply = ({ item }: { item: Reply }) => (
    <Pressable
      style={styles.replyCard}
      onPress={() => navigation.navigate("PostDetail", { postId: item.post_id })}
    >
      <View style={styles.replyContext}>
        {item.post_author?.avatar_url && (
          <Image source={{ uri: item.post_author.avatar_url }} style={styles.replyContextAvatar} contentFit="cover" />
        )}
        <Text style={styles.replyContextName} numberOfLines={1}>
          {item.post_author?.name || item.post_author?.username || "someone"}
        </Text>
        {item.post_content && (
          <Text style={styles.replyContextContent} numberOfLines={1}> · {item.post_content}</Text>
        )}
      </View>
      <View style={styles.replyBody}>
        <View style={styles.replyMeta}>
          {profile.avatar_url && (
            <Image source={{ uri: profile.avatar_url }} style={styles.replyAvatar} contentFit="cover" />
          )}
          <Text style={styles.replyAuthor}>{profile.name || profile.username}</Text>
          <Text style={styles.replyTime}>{timeAgo(item.created_at)}</Text>
        </View>
        <Text style={styles.replyContent}>{item.content}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {activeTab === "replies" ? (
        <FlatList
          data={replies}
          renderItem={renderReply}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ProfileHeader}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No replies yet</Text></View>}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
          contentContainerStyle={styles.list}
        />
      ) : (
        <FlatList
          data={filteredPosts}
          renderItem={({ item }) => <PostCard post={item} />}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ProfileHeader}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {activeTab === "hammers" ? "No hammered posts" : activeTab === "tails" ? "No tailed posts" : "No posts yet"}
              </Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: 100 },

  // Header
  headerSection: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  avatarCol: { alignItems: "center", gap: 4 },
  avatarRing: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 2.5,
    alignItems: "center", justifyContent: "center",
  },
  avatar: { width: 68, height: 68, borderRadius: 34 },
  avatarFallback: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: { fontSize: 28, fontWeight: "700", color: colors.emerald },
  activityText: { fontSize: 9, fontWeight: "600" },

  infoCol: { flex: 1, paddingTop: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  displayName: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text },
  winBadge: {
    backgroundColor: colors.emeraldBgStrong,
    borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  winBadgeText: { fontSize: 10, fontWeight: "700", color: colors.emerald },
  username: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },

  statsRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm, flexWrap: "wrap" },
  stat: { fontSize: fontSize.sm, color: colors.textMuted },
  statBold: { fontWeight: "700", color: colors.text },

  recordRow: { flexDirection: "row", marginTop: spacing.xs },
  recordWin: { fontSize: fontSize.sm, fontWeight: "700", color: colors.emerald },
  recordDash: { fontSize: fontSize.sm, color: colors.textMuted },
  recordLoss: { fontSize: fontSize.sm, fontWeight: "700", color: colors.red },

  bio: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },

  // Follow
  followRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  followBtn: {
    backgroundColor: colors.emerald,
    paddingVertical: 8,
    borderRadius: radius.md,
    alignItems: "center",
  },
  followBtnFollowing: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  followBtnText: { fontSize: fontSize.sm, fontWeight: "700", color: colors.black },
  followBtnTextFollowing: { color: colors.textSecondary },

  // Tabs
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: {
    flex: 1, paddingVertical: spacing.sm + 2, alignItems: "center",
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: colors.emerald },
  tabText: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  tabTextActive: { color: colors.emerald },

  // Reply card
  replyCard: {
    marginHorizontal: spacing.sm,
    marginVertical: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  replyContext: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(39,39,42,0.5)",
  },
  replyContextAvatar: { width: 14, height: 14, borderRadius: 7 },
  replyContextName: { fontSize: 11, fontWeight: "600", color: colors.textSecondary },
  replyContextContent: { fontSize: 11, color: colors.textDim, flex: 1 },
  replyBody: { padding: spacing.md },
  replyMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  replyAvatar: { width: 20, height: 20, borderRadius: 10 },
  replyAuthor: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  replyTime: { fontSize: fontSize.xs, color: colors.textMuted },
  replyContent: { fontSize: fontSize.md, color: colors.text, lineHeight: 22 },

  // Empty / Not found
  empty: { paddingVertical: 48, alignItems: "center" },
  emptyText: { fontSize: fontSize.md, color: colors.textMuted },
  notFound: { flex: 1, justifyContent: "center", alignItems: "center" },
  notFoundTitle: { fontSize: fontSize.lg, fontWeight: "600", color: colors.textMuted },
});

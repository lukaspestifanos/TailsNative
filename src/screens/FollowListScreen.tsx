import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { colors, fontSize, spacing, radius } from "../lib/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "FollowList">;

type FollowUser = {
  id: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

export default function FollowListScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();

  const { userId, tab: initialTab } = route.params;
  const [tab, setTab] = useState<"followers" | "following">(initialTab);
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  // Fetch who the current user follows (for follow/unfollow buttons)
  useEffect(() => {
    if (!user) return;
    supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", user.id)
      .then(({ data }) => {
        setFollowingSet(new Set((data || []).map((r: any) => r.following_id)));
      });
  }, [user]);

  // Fetch list when tab changes
  const fetchList = useCallback(async () => {
    setLoading(true);
    const column = tab === "followers" ? "follower_id" : "following_id";
    const filterColumn = tab === "followers" ? "following_id" : "follower_id";

    const { data } = await supabase
      .from("follows")
      .select(column)
      .eq(filterColumn, userId)
      .order("created_at", { ascending: false })
      .limit(100);

    const ids = (data || []).map((r: any) => r[column]);

    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, name, avatar_url, bio")
        .in("id", ids);
      setUsers(profiles || []);
    } else {
      setUsers([]);
    }
    setLoading(false);
  }, [tab, userId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const toggleFollow = useCallback(
    async (targetId: string) => {
      if (!user || user.id === targetId) return;
      setBusyIds((s) => new Set(s).add(targetId));

      if (followingSet.has(targetId)) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", targetId);
        if (!error) {
          setFollowingSet((s) => {
            const n = new Set(s);
            n.delete(targetId);
            return n;
          });
        }
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: user.id, following_id: targetId });
        if (!error) {
          setFollowingSet((s) => new Set(s).add(targetId));
        }
      }
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(targetId);
        return n;
      });
    },
    [user, followingSet]
  );

  const renderUser = useCallback(
    ({ item }: { item: FollowUser }) => {
      const isMe = user?.id === item.id;
      const isFollowing = followingSet.has(item.id);
      const isBusy = busyIds.has(item.id);

      return (
        <Pressable
          style={({ pressed }) => [s.row, pressed && s.rowPressed]}
          onPress={() => navigation.push("UserProfile", { username: item.username })}
        >
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={s.avatar} contentFit="cover" transition={0} />
          ) : (
            <View style={s.avatarFallback}>
              <Text style={s.avatarLetter}>{item.username[0]?.toUpperCase() || "?"}</Text>
            </View>
          )}

          <View style={s.info}>
            <Text style={s.name} numberOfLines={1}>
              {item.name || item.username}
            </Text>
            <Text style={s.username} numberOfLines={1}>
              @{item.username}
            </Text>
            {item.bio ? (
              <Text style={s.bio} numberOfLines={1}>
                {item.bio}
              </Text>
            ) : null}
          </View>

          {user && !isMe && (
            <Pressable
              style={[s.followBtn, isFollowing && s.followBtnFollowing]}
              onPress={() => toggleFollow(item.id)}
              disabled={isBusy}
              hitSlop={8}
            >
              <Text style={[s.followBtnText, isFollowing && s.followBtnTextFollowing]}>
                {isFollowing ? "Following" : "Follow"}
              </Text>
            </Pressable>
          )}
        </Pressable>
      );
    },
    [user, followingSet, busyIds, navigation, toggleFollow]
  );

  return (
    <View style={s.container}>
      {/* Tabs */}
      <View style={s.tabs}>
        <Pressable
          style={[s.tab, tab === "followers" && s.tabActive]}
          onPress={() => setTab("followers")}
        >
          <Text style={[s.tabText, tab === "followers" && s.tabTextActive]}>
            Followers
          </Text>
        </Pressable>
        <Pressable
          style={[s.tab, tab === "following" && s.tabActive]}
          onPress={() => setTab("following")}
        >
          <Text style={[s.tabText, tab === "following" && s.tabTextActive]}>
            Following
          </Text>
        </Pressable>
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator color={colors.emerald} style={{ marginTop: 40 }} />
      ) : users.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>
            {tab === "followers" ? "No followers yet" : "Not following anyone"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Tabs
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
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
    color: colors.text,
  },

  // User row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    gap: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.card,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.emerald,
  },
  info: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.text,
  },
  username: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  bio: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    marginTop: 2,
  },

  // Follow button
  followBtn: {
    backgroundColor: colors.emerald,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  followBtnFollowing: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.border,
  },
  followBtnText: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    color: colors.black,
  },
  followBtnTextFollowing: {
    color: colors.textMuted,
  },

  // Empty
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});

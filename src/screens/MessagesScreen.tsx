import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  AppState,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { FeedSkeleton } from "../components/Skeleton";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type ConversationPreview = {
  id: string;
  type: "dm" | "group";
  name: string | null;
  updated_at: string;
  participants: { id: string; username: string; avatar_url: string | null }[];
  last_message: { content: string; sender_id: string; created_at: string } | null;
  unread: boolean;
};

function formatRelative(timestamp: string): string {
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 6) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return "now";
}

export default function MessagesScreen() {
  const navigation = useNavigation<Nav>();
  const { session, user, profile } = useAuth();
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isGuest = !profile?.username;

  const loadConversations = useCallback(async (silent = false) => {
    if (!user) { if (!silent) setLoading(false); return; }
    const uid = user.id;

    try {
      const { data: myConvos } = await supabase
        .from("conversation_participants")
        .select("conversation_id, last_read_at")
        .eq("user_id", uid);

      if (!myConvos || myConvos.length === 0) {
        setConversations([]);
        if (!silent) setLoading(false);
        return;
      }

      const convoIds = myConvos.map((c: any) => c.conversation_id);
      const readMap = new Map(myConvos.map((c: any) => [c.conversation_id, c.last_read_at]));

      const { data: convos } = await supabase
        .from("conversations")
        .select("id, type, name, updated_at")
        .in("id", convoIds)
        .order("updated_at", { ascending: false });

      if (!convos || convos.length === 0) {
        setConversations([]);
        if (!silent) setLoading(false);
        return;
      }

      // Get all participants + profiles
      const { data: allParticipants } = await supabase
        .from("conversation_participants")
        .select("conversation_id, user_id")
        .in("conversation_id", convoIds);

      const allUserIds = [...new Set((allParticipants || []).map((p: any) => p.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", allUserIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

      // Get last message per conversation
      const lastMessages = new Map<string, any>();
      await Promise.all(convoIds.map(async (convoId: string) => {
        const { data: msgs } = await supabase
          .from("messages")
          .select("content, sender_id, created_at")
          .eq("conversation_id", convoId)
          .order("created_at", { ascending: false })
          .limit(1);
        if (msgs && msgs.length > 0) lastMessages.set(convoId, msgs[0]);
      }));

      const items: ConversationPreview[] = convos.map((c: any) => {
        const parts = (allParticipants || [])
          .filter((p: any) => p.conversation_id === c.id && p.user_id !== uid)
          .map((p: any) => profileMap.get(p.user_id))
          .filter(Boolean);
        const lastMsg = lastMessages.get(c.id) || null;
        const lastRead = readMap.get(c.id) || "1970-01-01T00:00:00Z";
        const unread = lastMsg ? new Date(lastMsg.created_at) > new Date(lastRead as string) : false;
        return { id: c.id, type: c.type, name: c.name, updated_at: c.updated_at, participants: parts, last_message: lastMsg, unread };
      });

      setConversations(items);
    } catch {}
    if (!silent) setLoading(false);
  }, [user]);

  useEffect(() => {
    if (user && !isGuest) {
      loadConversations();
      intervalRef.current = setInterval(() => loadConversations(true), 15000);
    } else {
      setLoading(false);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loadConversations, user, isGuest]);

  // Pause/resume on app state
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && user && !isGuest) {
        loadConversations(true);
        if (!intervalRef.current) intervalRef.current = setInterval(() => loadConversations(true), 15000);
      } else {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      }
    });
    return () => sub.remove();
  }, [loadConversations, user, isGuest]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  }, [loadConversations]);

  // Sign-in prompt for guests / unauthenticated
  if (!session || isGuest) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
        </View>
        <View style={styles.signInPrompt}>
          <View style={styles.signInIconWrap}>
            <Text style={styles.signInIcon}>DM</Text>
          </View>
          <Text style={styles.signInTitle}>Direct Messages</Text>
          <Text style={styles.signInSubtitle}>
            Sign in to message other users, share picks, and join group chats.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.signInBtn, pressed && styles.signInBtnPressed]}
            onPress={() => navigation.navigate("Login")}
          >
            <Text style={styles.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
        </View>
        <FeedSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />
        }
        renderItem={({ item: convo }) => {
          const otherUsers = convo.participants;
          const displayName =
            convo.type === "group" && convo.name
              ? convo.name
              : otherUsers.map((u) => u.username).join(", ") || "Unknown";

          const lastMsg = convo.last_message;
          const preview = lastMsg
            ? lastMsg.sender_id === user!.id
              ? `You: ${lastMsg.content}`
              : lastMsg.content
            : "No messages yet";

          const time = lastMsg ? formatRelative(lastMsg.created_at) : "";
          const avatar = otherUsers[0];

          return (
            <Pressable
              style={({ pressed }) => [
                styles.convoRow,
                convo.unread && styles.convoRowUnread,
                pressed && styles.convoRowPressed,
              ]}
              onPress={() => navigation.navigate("Conversation", { conversationId: convo.id })}
            >
              {/* Avatar */}
              {convo.type === "group" && otherUsers.length > 1 ? (
                <View style={styles.groupAvatarWrap}>
                  {otherUsers.slice(0, 2).map((u, i) => (
                    <View key={u.id} style={[styles.groupAvatar, i === 1 && styles.groupAvatarOverlap]}>
                      {u.avatar_url ? (
                        <Image source={{ uri: u.avatar_url }} style={styles.avatarImg} contentFit="cover" />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Text style={styles.avatarLetter}>{u.username?.[0]?.toUpperCase() || "?"}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.avatarWrap}>
                  {avatar?.avatar_url ? (
                    <Image source={{ uri: avatar.avatar_url }} style={styles.avatarImg} contentFit="cover" />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarLetter}>{avatar?.username?.[0]?.toUpperCase() || "?"}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Content */}
              <View style={styles.convoContent}>
                <View style={styles.convoTopRow}>
                  <Text style={[styles.convoName, convo.unread && styles.convoNameUnread]} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text style={styles.convoTime}>{time}</Text>
                </View>
                <Text style={[styles.convoPreview, convo.unread && styles.convoPreviewUnread]} numberOfLines={1}>
                  {preview}
                </Text>
              </View>

              {/* Unread dot */}
              {convo.unread && <View style={styles.unreadDot} />}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySubtitle}>Start a conversation from someone's profile</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingBottom: 100 },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text },

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
  signInIcon: { fontSize: 18, fontWeight: "800", color: colors.emerald },
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

  // Conversation row
  convoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  convoRowUnread: { backgroundColor: "rgba(16,185,129,0.03)" },
  convoRowPressed: { backgroundColor: colors.cardHover },

  // Avatars
  avatarWrap: { width: 44, height: 44, borderRadius: 22, overflow: "hidden" },
  avatarImg: { width: 44, height: 44 },
  avatarFallback: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: { fontSize: fontSize.md, fontWeight: "700", color: colors.emerald },
  groupAvatarWrap: { width: 44, height: 44, position: "relative" },
  groupAvatar: {
    position: "absolute", top: 0, left: 0, width: 30, height: 30, borderRadius: 15,
    borderWidth: 2, borderColor: colors.bg, overflow: "hidden",
  },
  groupAvatarOverlap: { top: 14, left: 14 },

  // Content
  convoContent: { flex: 1, minWidth: 0 },
  convoTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  convoName: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textSecondary, flex: 1 },
  convoNameUnread: { fontWeight: "700", color: colors.text },
  convoTime: { fontSize: 10, color: colors.textDim },
  convoPreview: { fontSize: 11, color: colors.textDim, marginTop: 2 },
  convoPreviewUnread: { color: colors.textSecondary },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.emerald },

  // Empty
  empty: { paddingVertical: 60, alignItems: "center", gap: spacing.sm },
  emptyTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.textMuted },
  emptySubtitle: { fontSize: fontSize.sm, color: colors.textDim },
});

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AppState,
} from "react-native";
import { Image } from "expo-image";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

type Route = RouteProp<RootStackParamList, "Conversation">;

type Message = {
  id: string;
  sender_id: string;
  content: string;
  image_url: string | null;
  created_at: string;
};

type Participant = {
  id: string;
  username: string;
  avatar_url: string | null;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function ConversationScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const convoId = params.conversationId;

  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [convoType, setConvoType] = useState<"dm" | "group">("dm");
  const [convoName, setConvoName] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load conversation data
  useEffect(() => {
    if (!user) return;
    const uid = user.id;

    (async () => {
      // Get conversation info
      const { data: convo } = await supabase
        .from("conversations")
        .select("type, name")
        .eq("id", convoId)
        .single();

      if (!convo) { navigation.goBack(); return; }
      setConvoType(convo.type);
      setConvoName(convo.name);

      // Get participants
      const { data: parts } = await supabase
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", convoId);

      const partIds = (parts || []).map((p: any) => p.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", partIds);
      setParticipants(profiles || []);

      // Set header title
      const others = (profiles || []).filter((p: any) => p.id !== uid);
      const title = convo.type === "group" && convo.name
        ? convo.name
        : others.map((p: any) => p.username).join(", ") || "Conversation";
      navigation.setOptions({ headerTitle: title });

      // Get messages
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, sender_id, content, image_url, created_at")
        .eq("conversation_id", convoId)
        .order("created_at", { ascending: true })
        .limit(200);

      setMessages(msgs || []);

      // Mark as read
      await supabase
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", convoId)
        .eq("user_id", uid);

      setLoading(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    })();
  }, [convoId, user, navigation]);

  // Poll for new messages every 3s
  useEffect(() => {
    if (!user || loading) return;

    const poll = async () => {
      const lastMsg = messages[messages.length - 1];
      const since = lastMsg?.created_at || "1970-01-01T00:00:00Z";

      const { data: newMsgs } = await supabase
        .from("messages")
        .select("id, sender_id, content, image_url, created_at")
        .eq("conversation_id", convoId)
        .gt("created_at", since)
        .order("created_at", { ascending: true });

      if (newMsgs && newMsgs.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const unique = newMsgs.filter((m: any) => !existingIds.has(m.id));
          return unique.length > 0 ? [...prev, ...unique] : prev;
        });
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

        // Mark as read
        await supabase
          .from("conversation_participants")
          .update({ last_read_at: new Date().toISOString() })
          .eq("conversation_id", convoId)
          .eq("user_id", user.id);
      }
    };

    intervalRef.current = setInterval(poll, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [convoId, user, loading, messages]);

  // Pause/resume polling on app state
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !user || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);

    const { data: msg, error } = await supabase
      .from("messages")
      .insert({ conversation_id: convoId, sender_id: user.id, content })
      .select("id, sender_id, content, image_url, created_at")
      .single();

    if (!error && msg) {
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

      // Update conversation timestamp
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convoId);

      // Mark as read
      await supabase
        .from("conversation_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", convoId)
        .eq("user_id", user.id);
    }

    setSending(false);
  }, [input, user, convoId, sending]);

  const profileMap = new Map(participants.map((p) => [p.id, p]));

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.emerald} />
        </View>
      </View>
    );
  }

  // Build data with date separators
  type ListItem = { type: "date"; date: string; key: string } | { type: "msg"; msg: Message; key: string };
  const listData: ListItem[] = [];
  let lastDate = "";
  for (const msg of messages) {
    const dateKey = new Date(msg.created_at).toDateString();
    if (dateKey !== lastDate) {
      listData.push({ type: "date", date: msg.created_at, key: `date_${dateKey}` });
      lastDate = dateKey;
    }
    listData.push({ type: "msg", msg, key: msg.id });
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <FlatList
        ref={flatListRef}
        data={listData}
        keyExtractor={(item) => item.key}
        onContentSizeChange={() => {
          // Auto-scroll on content change if near bottom
        }}
        renderItem={({ item, index }) => {
          if (item.type === "date") {
            return (
              <View style={styles.dateSeparator}>
                <Text style={styles.dateSeparatorText}>{formatDateSeparator(item.date)}</Text>
              </View>
            );
          }

          const msg = item.msg;
          const isMe = msg.sender_id === user?.id;
          const sender = profileMap.get(msg.sender_id);

          // Check if previous message was same sender (for grouping)
          const prevItem = index > 0 ? listData[index - 1] : null;
          const prevMsg = prevItem?.type === "msg" ? prevItem.msg : null;
          const isGrouped = prevMsg?.sender_id === msg.sender_id;

          return (
            <View style={[styles.msgRow, isMe && styles.msgRowMe, isGrouped && styles.msgRowGrouped]}>
              {/* Avatar for other users */}
              {!isMe ? (
                isGrouped ? (
                  <View style={styles.avatarSpacer} />
                ) : (
                  <Pressable
                    style={styles.msgAvatarWrap}
                    onPress={() => sender?.username && navigation.navigate("UserProfile", { username: sender.username })}
                  >
                    {sender?.avatar_url ? (
                      <Image source={{ uri: sender.avatar_url }} style={styles.msgAvatar} contentFit="cover" />
                    ) : (
                      <View style={styles.msgAvatarFallback}>
                        <Text style={styles.msgAvatarLetter}>{sender?.username?.[0]?.toUpperCase() || "?"}</Text>
                      </View>
                    )}
                  </Pressable>
                )
              ) : null}

              <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                {/* Sender name for group chats */}
                {!isMe && !isGrouped && convoType === "group" && (
                  <Text style={styles.senderName}>{sender?.username || "Unknown"}</Text>
                )}

                {/* Image */}
                {msg.image_url && (
                  <Image source={{ uri: msg.image_url }} style={styles.msgImage} contentFit="cover" />
                )}

                {/* Content */}
                {msg.content ? (
                  <Text style={[styles.msgText, isMe && styles.msgTextMe]}>{msg.content}</Text>
                ) : null}

                <Text style={[styles.msgTime, isMe && styles.msgTimeMe]}>{formatTime(msg.created_at)}</Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyMessages}>
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySubtext}>Send a message to start the conversation</Text>
          </View>
        }
        contentContainerStyle={styles.messagesList}
        showsVerticalScrollIndicator={false}
      />

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={setInput}
          placeholder="Message..."
          placeholderTextColor={colors.textDim}
          multiline
          maxLength={2000}
          returnKeyType="default"
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator color={colors.black} size="small" />
          ) : (
            <Text style={styles.sendBtnText}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },

  messagesList: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },

  // Date separator
  dateSeparator: { alignItems: "center", paddingVertical: spacing.md },
  dateSeparatorText: {
    fontSize: 10, fontWeight: "600", color: colors.textDim, textTransform: "uppercase",
    backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.full,
    overflow: "hidden",
  },

  // Message row
  msgRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: spacing.sm, gap: spacing.sm },
  msgRowMe: { flexDirection: "row-reverse" },
  msgRowGrouped: { marginBottom: 2 },

  // Avatar
  msgAvatarWrap: { width: 28, height: 28, borderRadius: 14, overflow: "hidden" },
  msgAvatar: { width: 28, height: 28 },
  msgAvatarFallback: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  msgAvatarLetter: { fontSize: 10, fontWeight: "700", color: colors.emerald },
  avatarSpacer: { width: 28 },

  // Bubble
  bubble: {
    maxWidth: "75%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  bubbleMe: {
    backgroundColor: colors.emerald,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: colors.card,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  senderName: { fontSize: 10, fontWeight: "700", color: colors.emeraldLight, marginBottom: 2 },
  msgText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 19 },
  msgTextMe: { color: colors.black },
  msgImage: { width: 200, height: 150, borderRadius: radius.md, marginBottom: 4 },
  msgTime: { fontSize: 9, color: colors.textDim, marginTop: 3 },
  msgTimeMe: { color: "rgba(0,0,0,0.45)" },

  // Input bar
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    gap: spacing.sm,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: fontSize.sm,
    color: colors.text,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: colors.emerald,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: colors.black, fontSize: fontSize.sm, fontWeight: "700" },

  // Empty
  emptyMessages: { paddingVertical: 60, alignItems: "center", gap: spacing.sm },
  emptyText: { fontSize: fontSize.md, fontWeight: "600", color: colors.textMuted },
  emptySubtext: { fontSize: fontSize.sm, color: colors.textDim },
});

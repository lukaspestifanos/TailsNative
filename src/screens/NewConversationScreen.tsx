import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { SafeAreaView } from "react-native-safe-area-context";
import { CloseIcon } from "../components/Icons";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type UserResult = {
  id: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
};

export default function NewConversationScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [selected, setSelected] = useState<UserResult[]>([]);
  const [groupName, setGroupName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [searching, setSearching] = useState(false);
  const messageRef = useRef<TextInput>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search users with debounce
  useEffect(() => {
    if (!search.trim() || !user) { setResults([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from("profiles")
        .select("id, username, name, avatar_url")
        .neq("id", user.id)
        .ilike("username", `%${search.trim()}%`)
        .limit(10);
      setResults(data || []);
      setSearching(false);
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, user]);

  // Focus message input when user selected
  useEffect(() => {
    if (selected.length > 0) setTimeout(() => messageRef.current?.focus(), 150);
  }, [selected.length]);

  const toggleUser = useCallback((u: UserResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected((prev) =>
      prev.find((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u]
    );
    setSearch("");
    setResults([]);
  }, []);

  const handleSend = useCallback(async () => {
    if (!user || selected.length === 0 || !message.trim() || sending) return;
    setSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const isGroup = selected.length > 1;
      const allUserIds = [user.id, ...selected.map((u) => u.id)];

      // For DMs, check if conversation already exists
      let existingConvoId: string | null = null;
      if (!isGroup) {
        const { data: myConvos } = await supabase
          .from("conversation_participants")
          .select("conversation_id")
          .eq("user_id", user.id);

        if (myConvos && myConvos.length > 0) {
          const myConvoIds = myConvos.map((c: any) => c.conversation_id);
          const { data: dmConvos } = await supabase
            .from("conversations")
            .select("id")
            .in("id", myConvoIds)
            .eq("type", "dm");

          if (dmConvos && dmConvos.length > 0) {
            const dmIds = dmConvos.map((c: any) => c.id);
            const { data: shared } = await supabase
              .from("conversation_participants")
              .select("conversation_id")
              .eq("user_id", selected[0].id)
              .in("conversation_id", dmIds)
              .limit(1);

            if (shared && shared.length > 0) existingConvoId = shared[0].conversation_id;
          }
        }
      }

      let convoId: string;

      if (existingConvoId) {
        convoId = existingConvoId;
      } else {
        convoId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        const { error: convoErr } = await supabase.from("conversations").insert({
          id: convoId,
          type: isGroup ? "group" : "dm",
          name: isGroup ? (groupName.trim() || selected.map((u) => u.username).join(", ")) : null,
        });

        if (convoErr) { setSending(false); return; }

        for (const uid of allUserIds) {
          await supabase.from("conversation_participants").insert({ conversation_id: convoId, user_id: uid });
        }
      }

      // Send first message
      await supabase.from("messages").insert({ conversation_id: convoId, sender_id: user.id, content: message.trim() });
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convoId);

      // Navigate to the conversation
      navigation.goBack();
      setTimeout(() => navigation.navigate("Conversation", { conversationId: convoId }), 100);
    } catch {
      setSending(false);
    }
  }, [user, selected, message, groupName, sending, navigation]);

  const isGroup = selected.length > 1;
  const canSend = selected.length > 0 && message.trim().length > 0 && !sending;

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
          <Text style={s.headerTitle}>New Message</Text>
          <View style={{ width: 50 }} />
        </View>

        {/* To: field */}
        <View style={s.toField}>
          <Text style={s.toLabel}>To:</Text>
          <View style={s.toChips}>
            {selected.map((u) => (
              <Pressable key={u.id} style={s.chip} onPress={() => toggleUser(u)}>
                <Text style={s.chipText}>{u.username}</Text>
                <CloseIcon size={10} color={colors.emerald} />
              </Pressable>
            ))}
            <TextInput
              style={s.toInput}
              value={search}
              onChangeText={setSearch}
              placeholder={selected.length === 0 ? "Search users..." : "Add more..."}
              placeholderTextColor={colors.textDim}
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus
            />
            {searching && <ActivityIndicator color={colors.emerald} size="small" />}
          </View>
        </View>

        {/* Group name */}
        {isGroup && (
          <View style={s.groupNameField}>
            <TextInput
              style={s.groupNameInput}
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Group name (optional)"
              placeholderTextColor={colors.textDim}
            />
          </View>
        )}

        {/* Content: search results OR compose area OR empty */}
        {search.trim() ? (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: u }) => {
              const isSelected = selected.some((s) => s.id === u.id);
              return (
                <Pressable style={({ pressed }) => [s.userRow, pressed && s.userRowPressed]} onPress={() => toggleUser(u)}>
                  {u.avatar_url ? (
                    <Image source={{ uri: u.avatar_url }} style={s.userAvatar} contentFit="cover" transition={0} />
                  ) : (
                    <View style={s.userAvatarFb}><Text style={s.userAvatarLtr}>{u.username[0]?.toUpperCase() || "?"}</Text></View>
                  )}
                  <View style={s.userInfo}>
                    <Text style={s.userName}>{u.name || u.username}</Text>
                    <Text style={s.userHandle}>@{u.username}</Text>
                  </View>
                  <View style={[s.checkCircle, isSelected && s.checkCircleOn]}>
                    {isSelected && <Text style={s.checkMark}>{"\u2713"}</Text>}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={!searching ? <View style={s.emptyState}><Text style={s.emptyText}>No users found</Text></View> : null}
          />
        ) : selected.length > 0 ? (
          <View style={s.composeArea}>
            {/* Selected user preview */}
            <View style={s.previewCenter}>
              {selected.length === 1 ? (
                <View style={s.previewSingle}>
                  {selected[0].avatar_url ? (
                    <Image source={{ uri: selected[0].avatar_url }} style={s.previewAvatar} contentFit="cover" transition={0} />
                  ) : (
                    <View style={s.previewAvatarFb}><Text style={s.previewAvatarLtr}>{selected[0].username[0]?.toUpperCase()}</Text></View>
                  )}
                  <Text style={s.previewName}>{selected[0].name || selected[0].username}</Text>
                  <Text style={s.previewHandle}>@{selected[0].username}</Text>
                </View>
              ) : (
                <View style={s.previewGroup}>
                  <View style={s.previewAvatarStack}>
                    {selected.slice(0, 4).map((u, i) => (
                      <View key={u.id} style={[s.previewStackItem, { marginLeft: i > 0 ? -12 : 0, zIndex: 4 - i }]}>
                        {u.avatar_url ? (
                          <Image source={{ uri: u.avatar_url }} style={s.previewStackAvatar} contentFit="cover" transition={0} />
                        ) : (
                          <View style={s.previewStackFb}><Text style={s.previewStackLtr}>{u.username[0]?.toUpperCase()}</Text></View>
                        )}
                      </View>
                    ))}
                  </View>
                  <Text style={s.previewName}>{selected.map((u) => u.username).join(", ")}</Text>
                  <Text style={s.previewHandle}>{selected.length} people</Text>
                </View>
              )}
            </View>

            {/* Message input */}
            <View style={s.composeBar}>
              <TextInput
                ref={messageRef}
                style={s.composeInput}
                value={message}
                onChangeText={setMessage}
                placeholder="Write a message..."
                placeholderTextColor={colors.textDim}
                multiline
                maxLength={2000}
              />
              <Pressable
                style={[s.composeSend, !canSend && s.composeSendDisabled]}
                onPress={handleSend}
                disabled={!canSend}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.composeSendIcon}>{"\u2191"}</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={s.emptyState}><Text style={s.emptyText}>Search for someone to message</Text></View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  cancelText: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "600" },
  headerTitle: { fontSize: fontSize.md, fontWeight: "700", color: colors.text },

  // To field
  toField: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  toLabel: { fontSize: fontSize.sm, color: colors.textDim, fontWeight: "500" },
  toChips: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: colors.emeraldBg, borderRadius: radius.full,
  },
  chipText: { fontSize: fontSize.xs, fontWeight: "600", color: colors.emerald },
  toInput: { flex: 1, minWidth: 100, fontSize: fontSize.sm, color: colors.text, paddingVertical: 4 },

  // Group name
  groupNameField: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  groupNameInput: { fontSize: fontSize.sm, color: colors.text },

  // User search results
  userRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  userRowPressed: { backgroundColor: colors.cardHover },
  userAvatar: { width: 44, height: 44, borderRadius: 22 },
  userAvatarFb: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardHover, alignItems: "center", justifyContent: "center" },
  userAvatarLtr: { fontSize: fontSize.md, fontWeight: "700", color: colors.emerald },
  userInfo: { flex: 1 },
  userName: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  userHandle: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  checkCircle: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.textDim,
    alignItems: "center", justifyContent: "center",
  },
  checkCircleOn: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  checkMark: { fontSize: 12, fontWeight: "800", color: colors.black },

  // Compose area
  composeArea: { flex: 1, justifyContent: "space-between" },
  previewCenter: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.xl },
  previewSingle: { alignItems: "center" },
  previewAvatar: { width: 64, height: 64, borderRadius: 32, marginBottom: spacing.md },
  previewAvatarFb: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.cardHover, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  previewAvatarLtr: { fontSize: 24, fontWeight: "700", color: colors.emerald },
  previewName: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  previewHandle: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  previewGroup: { alignItems: "center" },
  previewAvatarStack: { flexDirection: "row", marginBottom: spacing.md },
  previewStackItem: { borderWidth: 2, borderColor: colors.bg, borderRadius: 24, overflow: "hidden" },
  previewStackAvatar: { width: 44, height: 44, borderRadius: 22 },
  previewStackFb: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardHover, alignItems: "center", justifyContent: "center" },
  previewStackLtr: { fontSize: 16, fontWeight: "700", color: colors.emerald },

  composeBar: {
    flexDirection: "row", alignItems: "flex-end", gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    paddingBottom: Platform.OS === "ios" ? spacing.lg : spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  composeInput: {
    flex: 1, backgroundColor: "#1e1e22", borderRadius: 20,
    paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9,
    fontSize: 15, color: colors.text, maxHeight: 100, lineHeight: 20,
  },
  composeSend: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.emerald,
    alignItems: "center", justifyContent: "center", marginBottom: 2,
  },
  composeSendDisabled: { opacity: 0.3 },
  composeSendIcon: { fontSize: 18, fontWeight: "700", color: "#fff", marginTop: -1 },

  // Empty
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { fontSize: fontSize.sm, color: colors.textDim },
});

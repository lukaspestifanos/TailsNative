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
  Animated,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Haptics from "expo-haptics";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { Linking } from "react-native";
import { CloseIcon, ImageIcon } from "../components/Icons";

// Simple URL detection for message text
const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/gi;

function LinkedText({ text, isMe }: { text: string; isMe: boolean }) {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return <Text style={[st.msgText, isMe && st.msgTextMe]}>{text}</Text>;
  return (
    <Text style={[st.msgText, isMe && st.msgTextMe]}>
      {parts.map((part, i) =>
        URL_RE.test(part) ? (
          <Text key={i} style={isMe ? st.linkMe : st.linkOther} onPress={() => Linking.openURL(part)}>
            {part.replace(/^https?:\/\/(www\.)?/, "")}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}

type Route = RouteProp<RootStackParamList, "Conversation">;
type Reaction = { emoji: string; user_ids: string[] };

type Message = {
  id: string;
  sender_id: string;
  content: string;
  image_url: string | null;
  created_at: string;
  reply_to_id: string | null;
  reactions: Reaction[];
};

type Participant = { id: string; username: string; avatar_url: string | null };

const REACTIONS = ["\u2764\uFE0F", "\uD83D\uDE02", "\uD83D\uDD25", "\uD83D\uDC4D", "\uD83D\uDE22", "\u2753"];

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ` ${time}`;
}

function formatDateSep(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

// Consecutive = same sender, within 2 min, no system messages between
function isConsecutive(curr: Message, prev: Message | null): boolean {
  if (!prev) return false;
  if (prev.sender_id !== curr.sender_id) return false;
  if (prev.content.startsWith("::system::")) return false;
  return new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime() < 120000;
}

export default function ConversationScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const convoId = params.conversationId;

  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [convoType, setConvoType] = useState<"dm" | "group">("dm");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [reactionMsgId, setReactionMsgId] = useState<string | null>(null);
  const lastTap = useRef<{ id: string; time: number } | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const reactionAnim = useRef(new Animated.Value(0)).current;

  // GIF picker
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearch, setGifSearch] = useState("");
  const [gifResults, setGifResults] = useState<{ id: string; url: string; preview: string }[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const gifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Highlight a message when scrolling to it from reply
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const highlightAnim = useRef(new Animated.Value(1)).current;

  // Conversation name for group settings
  const [convoName, setConvoName] = useState<string | null>(null);

  const maxBubbleWidth = screenWidth * 0.72;

  // ── Load conversation ──
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: convo } = await supabase.from("conversations").select("type, name").eq("id", convoId).single();
      if (!convo) { navigation.goBack(); return; }
      setConvoType(convo.type);
      setConvoName(convo.name);

      const { data: parts } = await supabase.from("conversation_participants").select("user_id").eq("conversation_id", convoId);
      const partIds = (parts || []).map((p: any) => p.user_id);
      const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", partIds);
      setParticipants(profiles || []);

      const others = (profiles || []).filter((p: any) => p.id !== user.id);
      navigation.setOptions({
        headerTitle: convo.type === "group" && convo.name ? convo.name : others.map((p: any) => p.username).join(", ") || "Chat",
      });

      const { data: msgs } = await supabase.from("messages").select("id, sender_id, content, image_url, created_at").eq("conversation_id", convoId).order("created_at", { ascending: true }).limit(200);

      // Replies
      const replyMap = new Map<string, string>();
      try {
        const { data: rd } = await supabase.from("messages").select("id, reply_to_id").eq("conversation_id", convoId).not("reply_to_id", "is", null);
        for (const r of (rd || []) as any[]) if (r.reply_to_id) replyMap.set(r.id, r.reply_to_id);
      } catch {}

      // Reactions
      const rxMap = new Map<string, Reaction[]>();
      try {
        const mids = (msgs || []).map((m: any) => m.id);
        if (mids.length > 0) {
          const { data: rxd } = await supabase.from("message_reactions").select("message_id, user_id, emoji").in("message_id", mids);
          for (const r of (rxd || []) as any[]) {
            if (!rxMap.has(r.message_id)) rxMap.set(r.message_id, []);
            const arr = rxMap.get(r.message_id)!;
            const ex = arr.find((x) => x.emoji === r.emoji);
            if (ex) ex.user_ids.push(r.user_id);
            else arr.push({ emoji: r.emoji, user_ids: [r.user_id] });
          }
        }
      } catch {}

      setMessages((msgs || []).map((m: any) => ({ ...m, reply_to_id: replyMap.get(m.id) || null, reactions: rxMap.get(m.id) || [] })));
      await supabase.from("conversation_participants").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", convoId).eq("user_id", user.id);

      setLoading(false);
      // inverted FlatList starts at bottom automatically
    })();
  }, [convoId, user, navigation]);

  // ── Poll ──
  useEffect(() => {
    if (!user || loading) return;
    const poll = async () => {
      const last = messages[messages.length - 1];
      const since = last?.created_at || "1970-01-01T00:00:00Z";
      const { data: nm } = await supabase.from("messages").select("id, sender_id, content, image_url, created_at").eq("conversation_id", convoId).gt("created_at", since).order("created_at", { ascending: true });
      if (nm && nm.length > 0) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const fresh = nm.filter((m: any) => !ids.has(m.id)).map((m: any) => ({ ...m, reply_to_id: null, reactions: [] }));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
        // inverted FlatList auto-scrolls to newest
        await supabase.from("conversation_participants").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", convoId).eq("user_id", user.id);
      }
    };
    intervalRef.current = setInterval(poll, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [convoId, user, loading, messages]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active" && intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } });
    return () => sub.remove();
  }, []);

  // ── Image picker ──
  const pickImage = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!result.canceled && result.assets[0]) setImageUri(result.assets[0].uri);
  }, []);

  // ── Send ──
  const handleSend = useCallback(async () => {
    if ((!input.trim() && !imageUri) || !user || sending) return;
    const content = input.trim();
    const replyId = replyingTo?.id || null;
    const img = imageUri;
    setInput(""); setReplyingTo(null); setImageUri(null); setSending(true);

    let uploadedUrl: string | null = null;
    if (img) {
      try {
        const m = await ImageManipulator.manipulateAsync(img, [], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
        const path = `${user.id}/dm_${Date.now()}.jpg`;
        const ab = await (await fetch(m.uri)).arrayBuffer();
        const { error: ue } = await supabase.storage.from("post-media").upload(path, ab, { cacheControl: "3600", upsert: false, contentType: "image/jpeg" });
        if (!ue) { const { data } = supabase.storage.from("post-media").getPublicUrl(path); uploadedUrl = data.publicUrl; }
      } catch {}
    }

    const ins: any = { conversation_id: convoId, sender_id: user.id, content: content || "", image_url: uploadedUrl };
    if (replyId) ins.reply_to_id = replyId;

    const { data: msg, error } = await supabase.from("messages").insert(ins).select("id, sender_id, content, image_url, created_at").single();
    if (!error && msg) {
      setMessages((prev) => [...prev, { ...msg, reply_to_id: replyId, reactions: [] }]);
      // inverted FlatList auto-scrolls to newest
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convoId);
      await supabase.from("conversation_participants").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", convoId).eq("user_id", user.id);
    }
    setSending(false);
  }, [input, imageUri, user, convoId, sending, replyingTo]);

  // ── Double tap → reactions ──
  const onMsgPress = useCallback((msg: Message) => {
    const now = Date.now();
    if (lastTap.current && lastTap.current.id === msg.id && now - lastTap.current.time < 350) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setReactionMsgId(reactionMsgId === msg.id ? null : msg.id);
      reactionAnim.setValue(0);
      Animated.spring(reactionAnim, { toValue: 1, tension: 300, friction: 18, useNativeDriver: true }).start();
      lastTap.current = null;
    } else {
      lastTap.current = { id: msg.id, time: now };
    }
  }, [reactionMsgId, reactionAnim]);

  // ── React ──
  const handleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!user) return;
    setReactionMsgId(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const msg = messages.find((m) => m.id === messageId);
    const ex = msg?.reactions.find((r) => r.emoji === emoji);
    const mine = ex?.user_ids.includes(user.id);

    if (mine) {
      setMessages((p) => p.map((m) => m.id !== messageId ? m : { ...m, reactions: m.reactions.map((r) => r.emoji === emoji ? { ...r, user_ids: r.user_ids.filter((id) => id !== user.id) } : r).filter((r) => r.user_ids.length > 0) }));
      await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", user.id).eq("emoji", emoji);
    } else {
      const prev = msg?.reactions.find((r) => r.user_ids.includes(user.id));
      setMessages((p) => p.map((m) => {
        if (m.id !== messageId) return m;
        let up = m.reactions;
        if (prev) up = up.map((r) => r.emoji === prev.emoji ? { ...r, user_ids: r.user_ids.filter((id) => id !== user.id) } : r).filter((r) => r.user_ids.length > 0);
        const e = up.find((r) => r.emoji === emoji);
        up = e ? up.map((r) => r.emoji === emoji ? { ...r, user_ids: [...r.user_ids, user.id] } : r) : [...up, { emoji, user_ids: [user.id] }];
        return { ...m, reactions: up };
      }));
      if (prev) await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", user.id).eq("emoji", prev.emoji);
      await supabase.from("message_reactions").insert({ message_id: messageId, user_id: user.id, emoji });
    }
  }, [user, messages]);

  const handleReply = useCallback((msg: Message) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReplyingTo(msg);
    setReactionMsgId(null);
    inputRef.current?.focus();
  }, []);

  // ── GIF search ──
  const searchGifs = useCallback(async (query: string) => {
    setGifLoading(true);
    try {
      const url = query.trim()
        ? `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=LIVDSRZULELA&limit=20`
        : `https://g.tenor.com/v1/trending?key=LIVDSRZULELA&limit=20`;
      const res = await fetch(url);
      const data = await res.json();
      setGifResults(
        (data.results || []).map((g: any) => ({
          id: g.id,
          url: g.media?.[0]?.tinygif?.url || g.media?.[0]?.gif?.url || "",
          preview: g.media?.[0]?.nanogif?.url || g.media?.[0]?.tinygif?.url || "",
        }))
      );
    } catch {}
    setGifLoading(false);
  }, []);

  const handleGifSearch = useCallback((q: string) => {
    setGifSearch(q);
    if (gifTimer.current) clearTimeout(gifTimer.current);
    gifTimer.current = setTimeout(() => searchGifs(q), 350);
  }, [searchGifs]);

  const handleSendGif = useCallback(async (gifUrl: string) => {
    if (!user || sending) return;
    setSending(true);
    setShowGifPicker(false);
    setGifSearch("");
    setReplyingTo(null);

    const { data: msg, error } = await supabase
      .from("messages")
      .insert({ conversation_id: convoId, sender_id: user.id, content: "", image_url: gifUrl })
      .select("id, sender_id, content, image_url, created_at")
      .single();

    if (!error && msg) {
      setMessages((prev) => [...prev, { ...msg, reply_to_id: null, reactions: [] }]);
      // inverted FlatList auto-scrolls to newest
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convoId);
      await supabase.from("conversation_participants").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", convoId).eq("user_id", user.id);
    }
    setSending(false);
  }, [user, convoId, sending]);

  const profileMap = new Map(participants.map((p) => [p.id, p]));

  if (loading) return <View style={st.container}><ActivityIndicator color={colors.emerald} style={{ marginTop: 80 }} /></View>;

  // Build list data — reversed for inverted FlatList (newest at bottom = index 0)
  type Item = { type: "date"; date: string; key: string } | { type: "msg"; msg: Message; key: string; prevMsg: Message | null };
  const forwardData: Item[] = [];
  let prevDate = "";
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const dk = new Date(msg.created_at).toDateString();
    if (dk !== prevDate) { forwardData.push({ type: "date", date: msg.created_at, key: `d_${dk}` }); prevDate = dk; }
    forwardData.push({ type: "msg", msg, key: msg.id, prevMsg: i > 0 ? messages[i - 1] : null });
  }
  const data = [...forwardData].reverse();

  return (
    <KeyboardAvoidingView style={st.container} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
      <FlatList
        ref={flatListRef}
        data={data}
        inverted
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.md }}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={10}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => reactionMsgId && setReactionMsgId(null)}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }), 200);
        }}
        renderItem={({ item }) => {
          if (item.type === "date") return <View style={st.dateSep}><View style={st.dateSepPill}><Text style={st.dateSepText}>{formatDateSep(item.date)}</Text></View></View>;

          const { msg, prevMsg } = item;

          // System messages
          if (msg.content.startsWith("::system::")) {
            const systemText = msg.content.replace("::system::", "");
            return (
              <View style={st.systemMsg}>
                <View style={st.systemMsgPill}><Text style={st.systemMsgText}>{systemText}</Text></View>
              </View>
            );
          }

          const isMe = msg.sender_id === user?.id;
          const sender = profileMap.get(msg.sender_id);
          const grouped = isConsecutive(msg, prevMsg);
          const showTime = !grouped;
          const repliedMsg = msg.reply_to_id ? messages.find((m) => m.id === msg.reply_to_id) : null;
          const repliedSender = repliedMsg ? profileMap.get(repliedMsg.sender_id) : null;
          const hasImage = !!msg.image_url;
          const hasText = !!msg.content && !msg.content.startsWith("::system::");

          return (
            <View style={[{ marginBottom: grouped ? 1 : 6 }, showTime && !grouped && { marginTop: 12 }]}>
              {/* Timestamp between groups */}
              {showTime && !grouped && prevMsg && (
                <Text style={[st.timeLabel, isMe ? { textAlign: "right", paddingRight: 8 } : { paddingLeft: 40 }]}>
                  {formatTime(msg.created_at)}
                </Text>
              )}

              <Pressable
                style={[st.row, isMe && st.rowMe]}
                onPress={() => onMsgPress(msg)}
                onLongPress={() => handleReply(msg)}
                delayLongPress={300}
              >
                {/* Avatar */}
                {!isMe && (
                  grouped ? <View style={{ width: 30 }} /> : (
                    <Pressable onPress={() => sender?.username && navigation.navigate("UserProfile", { username: sender.username })}>
                      {sender?.avatar_url ? (
                        <Image source={{ uri: sender.avatar_url }} style={st.ava} contentFit="cover" transition={0} />
                      ) : (
                        <View style={st.avaFb}><Text style={st.avaLtr}>{sender?.username?.[0]?.toUpperCase() || "?"}</Text></View>
                      )}
                    </Pressable>
                  )
                )}

                <View style={{ maxWidth: maxBubbleWidth, position: "relative" }}>
                  {highlightMsgId === msg.id && (
                    <Animated.View style={[st.rowHighlight, { opacity: highlightAnim }]} pointerEvents="none" />
                  )}
                  {/* Group sender name */}
                  {!isMe && !grouped && convoType === "group" && (
                    <Text style={st.senderName}>{sender?.username || "?"}</Text>
                  )}

                  {/* Reply preview — tappable, scrolls to original */}
                  {repliedMsg && (
                    <Pressable
                      style={[st.replyPreview, isMe ? st.replyMe : st.replyThem]}
                      onPress={() => {
                        const idx = data.findIndex((d) => d.key === repliedMsg.id);
                        if (idx >= 0 && flatListRef.current) {
                          flatListRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
                          setHighlightMsgId(repliedMsg.id);
                          highlightAnim.setValue(1);
                          // Hold for 800ms then fade out over 700ms
                          setTimeout(() => {
                            Animated.timing(highlightAnim, { toValue: 0, duration: 700, useNativeDriver: true }).start(() => {
                              setHighlightMsgId(null);
                            });
                          }, 800);
                        }
                      }}
                    >
                      <Text style={st.replyName}>{repliedSender?.username || "user"}</Text>
                      <Text style={st.replyContent} numberOfLines={1}>
                        {repliedMsg.image_url ? "Photo" : (repliedMsg.content || "").slice(0, 60)}
                      </Text>
                    </Pressable>
                  )}

                  {/* Bubble */}
                  <View style={[
                    st.bubble,
                    isMe ? st.bubbleMe : st.bubbleOther,
                    grouped && isMe && { borderTopRightRadius: 6 },
                    grouped && !isMe && { borderTopLeftRadius: 6 },
                    hasImage && !hasText && { padding: 0 },
                  ]}>
                    {hasImage && (
                      <Pressable onPress={() => setLightboxUrl(msg.image_url)}>
                        <Image
                          source={{ uri: msg.image_url! }}
                          style={[st.msgImg, hasText ? st.msgImgWithText : st.msgImgOnly]}
                          contentFit="cover"
                          transition={0}
                        />
                      </Pressable>
                    )}
                    {hasText && (
                      <View style={hasImage ? { paddingTop: 8 } : undefined}>
                        <LinkedText text={msg.content} isMe={isMe} />
                      </View>
                    )}
                  </View>

                  {/* Reactions */}
                  {msg.reactions.length > 0 && (
                    <View style={[st.rxRow, isMe && st.rxRowMe]}>
                      {msg.reactions.map((r: Reaction) => {
                        const mine = r.user_ids.includes(user?.id || "");
                        return (
                          <Pressable key={r.emoji} style={[st.rxPill, mine && st.rxPillMine]} onPress={() => handleReaction(msg.id, r.emoji)}>
                            <Text style={{ fontSize: 11 }}>{r.emoji}</Text>
                            {r.user_ids.length > 1 && <Text style={st.rxCount}>{r.user_ids.length}</Text>}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {/* Reaction picker */}
                  {reactionMsgId === msg.id && (
                    <Animated.View style={[
                      st.picker,
                      isMe ? { right: 0 } : { left: 0 },
                      {
                        opacity: reactionAnim,
                        transform: [{ scale: reactionAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
                      },
                    ]}>
                      {REACTIONS.map((e) => (
                        <Pressable key={e} style={st.pickerBtn} onPress={() => handleReaction(msg.id, e)}>
                          <Text style={{ fontSize: 22 }}>{e}</Text>
                        </Pressable>
                      ))}
                    </Animated.View>
                  )}
                </View>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={<View style={st.empty}><Text style={st.emptyTitle}>No messages yet</Text><Text style={st.emptySub}>Say something!</Text></View>}
      />

      {/* GIF picker */}
      {showGifPicker && (
        <View style={st.gifPanel}>
          <TextInput
            style={st.gifSearch}
            value={gifSearch}
            onChangeText={handleGifSearch}
            placeholder="Search Tenor..."
            placeholderTextColor={colors.textDim}
            autoFocus
          />
          {gifLoading ? (
            <ActivityIndicator color={colors.emerald} style={{ paddingVertical: 40 }} />
          ) : gifResults.length === 0 ? (
            <Text style={st.gifEmpty}>{gifSearch ? "No GIFs found" : "Search for GIFs"}</Text>
          ) : (
            <FlatList
              data={gifResults}
              numColumns={3}
              keyExtractor={(g) => g.id}
              contentContainerStyle={{ gap: 4, padding: 4 }}
              columnWrapperStyle={{ gap: 4 }}
              renderItem={({ item: gif }) => (
                <Pressable
                  style={st.gifItem}
                  onPress={() => handleSendGif(gif.url)}
                >
                  <Image source={{ uri: gif.preview }} style={st.gifThumb} contentFit="cover" transition={0} />
                </Pressable>
              )}
              style={{ maxHeight: 200 }}
            />
          )}
          <View style={st.gifFooter}>
            <Text style={st.gifCredit}>Powered by Tenor</Text>
            <Pressable onPress={() => { setShowGifPicker(false); setGifSearch(""); setGifResults([]); }}>
              <Text style={st.gifClose}>Close</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Reply bar */}
      {replyingTo && (
        <View style={st.replyBar}>
          <View style={st.replyBarLine} />
          <View style={{ flex: 1 }}>
            <Text style={st.replyBarName}>{profileMap.get(replyingTo.sender_id)?.username || "user"}</Text>
            <Text style={st.replyBarText} numberOfLines={1}>{replyingTo.image_url ? "Photo" : (replyingTo.content || "").slice(0, 60)}</Text>
          </View>
          <Pressable onPress={() => setReplyingTo(null)} hitSlop={10}><CloseIcon size={16} color={colors.textMuted} /></Pressable>
        </View>
      )}

      {/* Image preview */}
      {imageUri && (
        <View style={st.imgPreview}>
          <Image source={{ uri: imageUri }} style={st.imgPreviewThumb} contentFit="cover" />
          <Pressable style={st.imgPreviewX} onPress={() => setImageUri(null)}><CloseIcon size={10} color="#fff" /></Pressable>
        </View>
      )}

      {/* Input bar */}
      <View style={st.inputBar}>
        <Pressable style={st.attachBtn} onPress={pickImage} hitSlop={6}>
          <ImageIcon size={18} color={colors.textMuted} />
        </Pressable>
        <Pressable
          style={st.attachBtn}
          onPress={() => { setShowGifPicker(!showGifPicker); if (!showGifPicker) searchGifs(""); }}
          hitSlop={6}
        >
          <Text style={st.gifBtnText}>GIF</Text>
        </Pressable>
        <TextInput
          ref={inputRef}
          style={st.input}
          value={input}
          onChangeText={setInput}
          placeholder={replyingTo ? "Reply..." : "Message..."}
          placeholderTextColor={colors.textDim}
          multiline
          maxLength={2000}
        />
        {(input.trim() || imageUri) ? (
          <Pressable style={st.sendBtn} onPress={handleSend} disabled={sending}>
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={st.sendIcon}>{"\u2191"}</Text>}
          </Pressable>
        ) : null}
      </View>

      {/* Image lightbox */}
      {lightboxUrl && (
        <Pressable style={st.lightbox} onPress={() => setLightboxUrl(null)}>
          <View style={st.lightboxBg}>
            <Image source={{ uri: lightboxUrl }} style={st.lightboxImg} contentFit="contain" transition={0} />
            <Pressable style={st.lightboxClose} onPress={() => setLightboxUrl(null)}>
              <CloseIcon size={20} color="#fff" />
            </Pressable>
          </View>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Date
  dateSep: { alignItems: "center", paddingVertical: 14 },
  dateSepPill: { backgroundColor: "rgba(39,39,42,0.6)", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99 },
  dateSepText: { fontSize: 11, fontWeight: "600", color: colors.textDim },

  // Timestamp
  timeLabel: { fontSize: 10, color: colors.textDim, marginBottom: 4 },

  // System messages
  systemMsg: { alignItems: "center", marginVertical: 12 },
  systemMsgPill: { backgroundColor: "rgba(39,39,42,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99 },
  systemMsgText: { fontSize: 11, color: colors.textDim },

  // Row
  row: { flexDirection: "row", alignItems: "flex-end", gap: 6, paddingHorizontal: 4 },
  rowMe: { flexDirection: "row-reverse" },

  // Avatar
  ava: { width: 28, height: 28, borderRadius: 14 },
  avaFb: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cardHover, alignItems: "center", justifyContent: "center" },
  avaLtr: { fontSize: 11, fontWeight: "700", color: colors.emerald },

  // Sender
  senderName: { fontSize: 10, fontWeight: "700", color: colors.textMuted, marginLeft: 6, marginBottom: 1 },

  // Reply preview — compact pill matching web
  replyPreview: {
    marginBottom: 3, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14, maxWidth: "100%",
  },
  replyMe: { backgroundColor: "rgba(5,150,105,0.25)" },
  replyThem: { backgroundColor: "rgba(63,63,70,0.4)" },
  replyName: { fontSize: 11, fontWeight: "700", color: colors.emeraldLight },
  replyContent: { fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 1 },

  // Highlight when scrolling to a replied message
  rowHighlight: {
    position: "absolute",
    top: -4, left: -6, right: -6, bottom: -4,
    backgroundColor: "rgba(16,185,129,0.15)",
    borderRadius: 22,
    zIndex: -1,
  },

  // Bubble
  bubble: {
    borderRadius: 20,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  bubbleMe: { backgroundColor: colors.emerald, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: "#1e1e22", borderBottomLeftRadius: 6 },
  msgText: { fontSize: 15, lineHeight: 21, color: "#e4e4e7", paddingHorizontal: 14, paddingVertical: 9 },
  msgTextMe: { color: "#000" },
  linkOther: { color: colors.emerald, textDecorationLine: "underline" },
  linkMe: { color: "rgba(255,255,255,0.9)", textDecorationLine: "underline" },
  msgImg: { borderRadius: 0 },
  msgImgWithText: { width: 240, height: 180, marginBottom: -4 },
  msgImgOnly: { width: 240, height: 180, borderRadius: 20 },

  // Reactions
  rxRow: { flexDirection: "row", gap: 3, marginTop: 2, marginLeft: 4 },
  rxRowMe: { justifyContent: "flex-end", marginRight: 4, marginLeft: 0 },
  rxPill: {
    flexDirection: "row", alignItems: "center", gap: 2,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 99,
    backgroundColor: "#27272a", borderWidth: 1, borderColor: "#3f3f46",
  },
  rxPillMine: { backgroundColor: "rgba(16,185,129,0.15)", borderColor: "rgba(16,185,129,0.3)" },
  rxCount: { fontSize: 9, color: colors.textDim, fontWeight: "600" },

  // Reaction picker
  picker: {
    position: "absolute", bottom: "100%", marginBottom: 6, zIndex: 30,
    flexDirection: "row", gap: 2,
    backgroundColor: "#18181b", borderWidth: 1, borderColor: "#3f3f46",
    borderRadius: 28, paddingHorizontal: 4, paddingVertical: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 10,
  },
  pickerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  // Reply bar
  replyBar: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: "#111113",
  },
  replyBarLine: { width: 3, height: 28, borderRadius: 2, backgroundColor: colors.emerald },
  replyBarName: { fontSize: 12, fontWeight: "700", color: colors.emerald },
  replyBarText: { fontSize: 12, color: colors.textDim, marginTop: 1 },

  // Image preview
  imgPreview: {
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: "#111113", flexDirection: "row",
  },
  imgPreviewThumb: { width: 52, height: 52, borderRadius: 10 },
  imgPreviewX: {
    position: "absolute", top: 10, left: spacing.md + 38,
    width: 18, height: 18, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center",
  },

  // Input bar
  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: spacing.sm, paddingTop: 6,
    paddingBottom: Platform.OS === "ios" ? 28 : 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  attachBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  input: {
    flex: 1, backgroundColor: "#1e1e22",
    borderRadius: 20, paddingHorizontal: 14,
    paddingTop: Platform.OS === "ios" ? 9 : 8,
    paddingBottom: Platform.OS === "ios" ? 9 : 8,
    fontSize: 15, color: colors.text, maxHeight: 100,
    lineHeight: 20,
  },
  sendBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.emerald,
    alignItems: "center", justifyContent: "center",
    marginBottom: 2,
  },
  sendIcon: { fontSize: 18, fontWeight: "700", color: "#fff", marginTop: -1 },

  // GIF picker
  gifPanel: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: "#111113" },
  gifSearch: {
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: 15, color: colors.text,
  },
  gifEmpty: { fontSize: fontSize.sm, color: colors.textDim, textAlign: "center", paddingVertical: 32 },
  gifItem: { flex: 1 / 3, aspectRatio: 1, borderRadius: 8, overflow: "hidden" },
  gifThumb: { width: "100%", height: "100%" },
  gifFooter: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  gifCredit: { fontSize: 9, color: colors.textDim },
  gifClose: { fontSize: fontSize.xs, color: colors.textMuted },
  gifBtnText: { fontSize: 10, fontWeight: "800", color: colors.textMuted },

  // Lightbox
  lightbox: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
  },
  lightboxBg: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center", alignItems: "center",
  },
  lightboxImg: { width: "90%", height: "70%" },
  lightboxClose: {
    position: "absolute", top: 60, right: 20,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },

  // Empty
  empty: { paddingVertical: 80, alignItems: "center", gap: 4 },
  emptyTitle: { fontSize: fontSize.md, fontWeight: "600", color: colors.textMuted },
  emptySub: { fontSize: fontSize.sm, color: colors.textDim },
});

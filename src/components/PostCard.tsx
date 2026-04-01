import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  ActionSheetIOS,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Post } from "../lib/types";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { timeAgo, formatPickType, formatPickLabel } from "../lib/formatters";
import { parseImageUrls } from "../lib/parseImageUrls";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { HammerIcon, TailIcon, CommentIcon, ChevronRight } from "./Icons";
import { ImageCarousel, Lightbox } from "./MediaViewer";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface PostCardProps {
  post: Post;
}

const SCREEN_WIDTH = Dimensions.get("window").width;

export default function PostCard({ post }: PostCardProps) {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes_count);
  const [tailed, setTailed] = useState(false);
  const [tailCount, setTailCount] = useState(post.tails_count);

  // Tail Spin (quote post) state
  const [showTailSpin, setShowTailSpin] = useState(false);
  const [quoteContent, setQuoteContent] = useState("");
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);

  // Check like/tail status on mount
  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase
        .from("likes")
        .select("id")
        .eq("post_id", post.id)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("tails")
        .select("id")
        .eq("post_id", post.id)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]).then(([likeRes, tailRes]) => {
      setLiked(!!likeRes.data);
      setTailed(!!tailRes.data);
    });
  }, [post.id, user?.id]);

  const handleLike = useCallback(async () => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (liked) {
      setLiked(false);
      setLikeCount((c) => Math.max(0, c - 1));
      await supabase
        .from("likes")
        .delete()
        .eq("post_id", post.id)
        .eq("user_id", user.id);
    } else {
      setLiked(true);
      setLikeCount((c) => c + 1);
      await supabase
        .from("likes")
        .insert({ post_id: post.id, user_id: user.id });
    }
  }, [liked, user, post.id]);

  // Simple tail (repost)
  const doTail = useCallback(async () => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (tailed) {
      setTailed(false);
      setTailCount((c) => Math.max(0, c - 1));
      await supabase.from("tails").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      setTailed(true);
      setTailCount((c) => c + 1);
      await supabase.from("tails").insert({ post_id: post.id, user_id: user.id });
    }
  }, [tailed, user, post.id]);

  // Tail Spin (quote post)
  const handleQuotePost = useCallback(async () => {
    if (!user || quoteSubmitting || !quoteContent.trim()) return;
    setQuoteSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const { error } = await supabase.from("posts").insert({
      user_id: user.id,
      content: quoteContent.trim(),
      quote_post_id: post.id,
    });

    if (!error) {
      // Also count as a tail if not already tailed
      if (!tailed) {
        await supabase.from("tails").insert({ post_id: post.id, user_id: user.id });
        setTailed(true);
        setTailCount((c) => c + 1);
      }
      setShowTailSpin(false);
      setQuoteContent("");
    } else {
      Alert.alert("Error", "Failed to post");
    }
    setQuoteSubmitting(false);
  }, [user, quoteContent, quoteSubmitting, post.id, tailed]);

  // Tap tail button → if already tailed, untail. Otherwise show action sheet.
  const handleTail = useCallback(() => {
    if (!user) return;

    if (tailed) {
      doTail();
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Tail", "Tail Spin"],
          cancelButtonIndex: 0,
          title: "Repost this pick",
        },
        (idx) => {
          if (idx === 1) doTail();
          if (idx === 2) setShowTailSpin(true);
        }
      );
    } else {
      // Android fallback — just show the two options via Alert
      Alert.alert("Repost this pick", undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Tail", onPress: doTail },
        { text: "Tail Spin", onPress: () => setShowTailSpin(true) },
      ]);
    }
  }, [tailed, user, doTail]);

  const onUserPress = () => {
    if (post.profiles?.username) {
      navigation.navigate("UserProfile", { username: post.profiles.username });
    }
  };
  const onGamePress = () => {
    if (post.game_id) {
      navigation.navigate("GameDetail", { gameId: post.game_id });
    }
  };

  const imageUrls = parseImageUrls(post.image_url);
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // If post has video, tapping the card goes to the Twitter-style video screen
  const videoUrl = imageUrls.find(
    (u) => /\.(mp4|mov|webm|m4v)/i.test(u) || u.includes("video")
  );
  const onPress = () => {
    if (videoUrl) {
      navigation.navigate("VideoPost", { postId: post.id, videoUrl });
    } else {
      navigation.navigate("PostDetail", { postId: post.id });
    }
  };

  const hasPickResult = post.pick_result && post.pick_result !== "pending";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {/* Header row — avatar, name, time */}
      <View style={styles.header}>
        <Pressable onPress={onUserPress}>
          {post.profiles?.avatar_url ? (
            <Image
              source={{ uri: post.profiles.avatar_url }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarLetter}>
                {post.profiles?.username?.[0]?.toUpperCase() || "?"}
              </Text>
            </View>
          )}
        </Pressable>

        <View style={styles.headerText}>
          <Pressable onPress={onUserPress}>
            <Text style={styles.name} numberOfLines={1}>
              {post.profiles?.name || post.profiles?.username || "anonymous"}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
      </View>

      {/* Content */}
      {post.content ? (
        <Text style={styles.content} numberOfLines={6}>
          {post.content}
        </Text>
      ) : null}

      {/* Pick tag — with logos */}
      {post.games && post.pick_type && (
        <Pressable style={styles.pickTag} onPress={onGamePress}>
          {post.games.away_logo && (
            <Image source={{ uri: post.games.away_logo }} style={styles.gameTagLogo} contentFit="contain" />
          )}
          <View style={styles.pickTeams}>
            <Text style={styles.pickTeamText} numberOfLines={1}>
              {formatPickType(post.pick_type, post.games.home_team, post.games.away_team)}
            </Text>
            <Text style={styles.pickLine}>
              {formatPickLabel(post.pick_type, post.pick_line, post.pick_odds)}
            </Text>
          </View>
          {hasPickResult && (
            <View style={[
              styles.resultBadge,
              post.pick_result === "win" ? styles.resultWin
                : post.pick_result === "loss" ? styles.resultLoss
                : styles.resultPush,
            ]}>
              <Text style={styles.resultText}>
                {post.pick_result === "win" ? "W" : post.pick_result === "loss" ? "L" : "P"}
              </Text>
            </View>
          )}
        </Pressable>
      )}

      {/* Game tag — logos + teams + time + chevron (matches web's SlipCard game tag) */}
      {post.games && !post.pick_type && (
        <Pressable style={styles.gameTag} onPress={onGamePress}>
          {post.games.away_logo ? (
            <Image source={{ uri: post.games.away_logo }} style={styles.gameTagLogo} contentFit="contain" />
          ) : (
            <View style={styles.gameTagLogoFallback}>
              <Text style={styles.gameTagLogoLetter}>{post.games.away_team.split(" ").pop()?.[0]}</Text>
            </View>
          )}
          <Text style={styles.gameTagTeam} numberOfLines={1}>{post.games.away_team}</Text>
          <Text style={styles.gameTagAt}>@</Text>
          {post.games.home_logo ? (
            <Image source={{ uri: post.games.home_logo }} style={styles.gameTagLogo} contentFit="contain" />
          ) : (
            <View style={styles.gameTagLogoFallback}>
              <Text style={styles.gameTagLogoLetter}>{post.games.home_team.split(" ").pop()?.[0]}</Text>
            </View>
          )}
          <Text style={styles.gameTagTeam} numberOfLines={1}>{post.games.home_team}</Text>
          <ChevronRight size={14} color={colors.textMuted} />
        </Pressable>
      )}

      {/* Media — carousel with lightbox, same as web's ImageCarousel */}
      {imageUrls.length > 0 && (
        <View style={styles.mediaContainer}>
          <ImageCarousel
            urls={imageUrls}
            onOpenLightbox={(i) => setLightboxIndex(i)}
          />
          <Lightbox
            urls={imageUrls.filter((u) => !/\.(mp4|mov|webm|m4v)/i.test(u) && !u.includes("video"))}
            startIndex={Math.max(0, lightboxIndex)}
            visible={lightboxIndex >= 0}
            onClose={() => setLightboxIndex(-1)}
          />
        </View>
      )}

      {/* Quoted post — tap to drill into the original */}
      {post.quote_post && (
        <Pressable
          style={styles.quoteCard}
          onPress={(e) => {
            e.stopPropagation?.();
            navigation.navigate("PostDetail", { postId: post.quote_post!.id });
          }}
        >
          <View style={styles.quoteHeader}>
            {post.quote_post.profiles?.avatar_url ? (
              <Image source={{ uri: post.quote_post.profiles.avatar_url }} style={styles.quoteAvatar} contentFit="cover" />
            ) : (
              <View style={styles.quoteAvatarFallback}>
                <Text style={styles.quoteAvatarLetter}>
                  {post.quote_post.profiles?.username?.[0]?.toUpperCase() || "?"}
                </Text>
              </View>
            )}
            <Text style={styles.quoteName} numberOfLines={1}>
              {post.quote_post.profiles?.name || post.quote_post.profiles?.username || "user"}
            </Text>
            <Text style={styles.quoteTime}>{timeAgo(post.quote_post.created_at)}</Text>
          </View>
          {post.quote_post.content && (
            <Text style={styles.quoteContent} numberOfLines={3}>{post.quote_post.content}</Text>
          )}
          {post.quote_post.image_url && parseImageUrls(post.quote_post.image_url).length > 0 && (
            <Image
              source={{ uri: parseImageUrls(post.quote_post.image_url)[0] }}
              style={styles.quoteImage}
              contentFit="cover"
            />
          )}
        </Pressable>
      )}

      {/* Action bar — like, tail, comment (same layout as web's SlipCard footer) */}
      <View style={styles.actions}>
        <Pressable onPress={handleLike} style={styles.actionBtn} hitSlop={8}>
          <HammerIcon
            size={16}
            color={liked ? colors.emerald : colors.textMuted}
            filled={liked}
          />
          <Text style={[styles.actionCount, liked && styles.actionActive]}>
            {likeCount > 0 ? String(likeCount) : ""}
          </Text>
        </Pressable>

        <View style={styles.actionDivider} />

        <Pressable onPress={handleTail} style={styles.actionBtn} hitSlop={8}>
          <TailIcon
            size={16}
            color={tailed ? colors.emerald : colors.textMuted}
          />
          <Text style={[styles.actionCount, tailed && styles.actionActive]}>
            {tailCount > 0 ? String(tailCount) : ""}
          </Text>
        </Pressable>

        <View style={styles.actionDivider} />

        <Pressable onPress={onPress} style={styles.actionBtn} hitSlop={8}>
          <CommentIcon size={16} color={colors.textMuted} />
          <Text style={styles.actionCount}>
            {post.comments_count > 0 ? String(post.comments_count) : ""}
          </Text>
        </Pressable>
      </View>

      {/* Tail Spin Modal — quote post compose */}
      <Modal
        visible={showTailSpin}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTailSpin(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={tsStyles.backdrop}
        >
          <Pressable style={tsStyles.backdropPress} onPress={() => setShowTailSpin(false)} />
          <View style={tsStyles.sheet}>
            {/* Header */}
            <View style={tsStyles.header}>
              <Text style={tsStyles.headerTitle}>Tail Spin</Text>
              <Pressable onPress={() => setShowTailSpin(false)} hitSlop={12}>
                <Text style={tsStyles.headerClose}>Cancel</Text>
              </Pressable>
            </View>

            {/* Compose area */}
            <TextInput
              style={tsStyles.input}
              value={quoteContent}
              onChangeText={setQuoteContent}
              placeholder="Add your take..."
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={280}
              autoFocus
            />
            <Text style={tsStyles.charCount}>{quoteContent.length}/280</Text>

            {/* Quoted post preview */}
            <View style={tsStyles.preview}>
              <View style={tsStyles.previewHeader}>
                {post.profiles?.avatar_url ? (
                  <Image source={{ uri: post.profiles.avatar_url }} style={tsStyles.previewAvatar} />
                ) : (
                  <View style={tsStyles.previewAvatarPlaceholder}>
                    <Text style={tsStyles.previewAvatarLetter}>
                      {post.profiles?.username?.[0]?.toUpperCase() || "?"}
                    </Text>
                  </View>
                )}
                <Text style={tsStyles.previewName} numberOfLines={1}>
                  {post.profiles?.name || post.profiles?.username || "user"}
                </Text>
              </View>
              {post.content ? (
                <Text style={tsStyles.previewContent} numberOfLines={3}>
                  {post.content}
                </Text>
              ) : null}
              {imageUrls.length > 0 && (
                <Image source={{ uri: imageUrls[0] }} style={tsStyles.previewImage} contentFit="cover" />
              )}
            </View>

            {/* Post button */}
            <Pressable
              onPress={handleQuotePost}
              disabled={quoteSubmitting || !quoteContent.trim()}
              style={[tsStyles.postBtn, (quoteSubmitting || !quoteContent.trim()) && tsStyles.postBtnDisabled]}
            >
              <Text style={tsStyles.postBtnText}>{quoteSubmitting ? "Posting..." : "Post"}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Pressable>
  );
}

// Tail Spin modal styles
const tsStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdropPress: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  headerTitle: {
    fontSize: fontSize.md,
    fontWeight: "700",
    color: colors.text,
  },
  headerClose: {
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.cardHover,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: "top",
  },
  charCount: {
    textAlign: "right",
    fontSize: 10,
    color: colors.textDim,
    marginTop: 4,
  },
  preview: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(63,63,70,0.6)",
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  previewAvatar: { width: 16, height: 16, borderRadius: 8 },
  previewAvatarPlaceholder: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  previewAvatarLetter: { color: colors.emerald, fontSize: 7, fontWeight: "700" },
  previewName: { fontSize: fontSize.xs, fontWeight: "600", color: colors.textSecondary },
  previewContent: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    lineHeight: 16,
  },
  previewImage: {
    width: "100%",
    height: 100,
  },
  postBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.emerald,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  postBtnDisabled: { opacity: 0.4 },
  postBtnText: { color: colors.black, fontSize: fontSize.md, fontWeight: "700" },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.sm,
    marginVertical: spacing.xs,
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.985 }],
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.cardHover,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    color: colors.emerald,
    fontSize: 12,
    fontWeight: "700",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.text,
  },
  time: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },

  // Content
  content: {
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  // Pick tag
  pickTag: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.cardHover,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pickTeams: {
    flex: 1,
  },
  pickTeamText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.text,
  },
  pickLine: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  resultBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  resultWin: { backgroundColor: colors.emeraldBgStrong },
  resultLoss: { backgroundColor: colors.redBg },
  resultPush: { backgroundColor: "rgba(161, 161, 170, 0.15)" },
  resultText: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    color: colors.text,
  },

  // Game tag — logos + teams + chevron
  gameTag: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: "rgba(39,39,42,0.8)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    gap: 5,
  },
  gameTagLogo: {
    width: 14,
    height: 14,
  },
  gameTagLogoFallback: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.cardHover,
    alignItems: "center",
    justifyContent: "center",
  },
  gameTagLogoLetter: {
    fontSize: 7,
    fontWeight: "700",
    color: colors.textMuted,
  },
  gameTagTeam: {
    fontSize: 11,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  gameTagAt: {
    fontSize: 11,
    color: colors.textDim,
  },

  // Media
  mediaContainer: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },

  // Quote post embed
  quoteCard: {
    marginHorizontal: spacing.md,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: "rgba(63,63,70,0.6)",
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  quoteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.sm,
    paddingBottom: 3,
  },
  quoteAvatar: { width: 14, height: 14, borderRadius: 7 },
  quoteAvatarFallback: {
    width: 14, height: 14, borderRadius: 7, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  quoteAvatarLetter: { color: colors.emerald, fontSize: 7, fontWeight: "700" },
  quoteName: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.textSecondary,
    flex: 1,
  },
  quoteTime: {
    fontSize: 10,
    color: colors.textDim,
  },
  quoteContent: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 16,
    paddingHorizontal: spacing.sm + 2,
    paddingBottom: spacing.sm,
  },
  quoteImage: {
    width: "100%",
    height: 100,
  },

  // Actions
  actions: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "rgba(39, 39, 42, 0.5)",
    gap: spacing.xl,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.sm,
  },
  actionDivider: {
    width: 1,
    height: 20,
    backgroundColor: colors.border,
  },
  actionCount: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  actionActive: {
    color: colors.emerald,
  },
});

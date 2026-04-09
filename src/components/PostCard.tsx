import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  Animated,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import type { Post } from "../lib/types";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { timeAgo, formatPickType, formatPickLabel } from "../lib/formatters";
import { parseImageUrls } from "../lib/parseImageUrls";
import { supabase } from "../lib/supabase";
import { getInteraction, setInteraction } from "../lib/interactionCache";
import { HammerIcon, TailIcon, CommentIcon, ChevronRight, MoreIcon, ImageIcon, CloseIcon } from "./Icons";
import { ImageCarousel, Lightbox } from "./MediaViewer";
import MentionText from "./MentionText";

interface PostCardProps {
  post: Post;
  onNavigate: (screen: string, params: any) => void;
  userId: string | null;
  focusKey?: number;
}

const SCREEN_WIDTH = Dimensions.get("window").width;

// Aspect-ratio-aware image for quote post embeds (matches web ImageCarousel behavior)
const QUOTE_MAX_HEIGHT = 500;
const QUOTE_IMAGE_WIDTH = SCREEN_WIDTH - 2 * spacing.sm - 2 * spacing.md - 2;

const QuoteImage = React.memo(function QuoteImage({ uri }: { uri: string }) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const { Image: RNImage } = require("react-native");
    RNImage.getSize(
      uri,
      (w: number, h: number) => {
        const natural = Math.round(QUOTE_IMAGE_WIDTH * (h / w));
        setHeight(Math.min(natural, QUOTE_MAX_HEIGHT));
      },
      () => setHeight(200)
    );
  }, [uri]);

  if (!height) return null;

  return (
    <Image
      source={{ uri }}
      style={{ width: "100%", height, backgroundColor: colors.card }}
      contentFit="cover"
      transition={0}
    />
  );
});

// Static post body — memoized separately so interaction state changes don't re-render images/text
const PostBody = React.memo(function PostBody({ post, onNavigate, isOwn, onMenuPress }: { post: Post; onNavigate: (screen: string, params: any) => void; isOwn: boolean; onMenuPress?: () => void }) {
  const avatarSource = useMemo(() => post.profiles?.avatar_url ? { uri: post.profiles.avatar_url } : null, [post.profiles?.avatar_url]);
  const awayLogoSource = useMemo(() => post.games?.away_logo ? { uri: post.games.away_logo } : null, [post.games?.away_logo]);
  const homeLogoSource = useMemo(() => post.games?.home_logo ? { uri: post.games.home_logo } : null, [post.games?.home_logo]);
  const quoteAvatarSource = useMemo(() => post.quote_post?.profiles?.avatar_url ? { uri: post.quote_post.profiles.avatar_url } : null, [post.quote_post?.profiles?.avatar_url]);
  const imageUrls = useMemo(() => parseImageUrls(post.image_url), [post.image_url]);
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  const onUserPress = useCallback(() => {
    if (post.profiles?.username) onNavigate("UserProfile", { username: post.profiles.username });
  }, [post.profiles?.username, onNavigate]);
  const onGamePress = useCallback(() => {
    if (post.game_id) onNavigate("GameDetail", { gameId: post.game_id });
  }, [post.game_id, onNavigate]);

  const hasPickResult = post.pick_result && post.pick_result !== "pending";

  return (
    <>
      {/* Header row */}
      <View style={styles.header}>
        <Pressable onPress={onUserPress}>
          {avatarSource ? (
            <Image source={avatarSource} style={styles.avatar} contentFit="cover" recyclingKey={post.profiles?.avatar_url} transition={0} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarLetter}>{post.profiles?.username?.[0]?.toUpperCase() || "?"}</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.headerText}>
          <Pressable onPress={onUserPress}>
            <Text style={styles.name} numberOfLines={1}>{post.profiles?.name || post.profiles?.username || "anonymous"}</Text>
          </Pressable>
        </View>
        <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
        {isOwn && onMenuPress && (
          <Pressable onPress={onMenuPress} hitSlop={12} style={styles.menuBtn}>
            <MoreIcon size={16} color={colors.textDim} />
          </Pressable>
        )}
      </View>

      {post.content ? <MentionText text={post.content} style={styles.content} numberOfLines={6} /> : null}

      {/* Pick tag */}
      {post.games && post.pick_type && (
        <Pressable style={styles.pickTag} onPress={onGamePress}>
          {awayLogoSource && <Image source={awayLogoSource} style={styles.gameTagLogo} contentFit="contain" transition={0} />}
          <View style={styles.pickTeams}>
            <Text style={styles.pickTeamText} numberOfLines={1}>{formatPickType(post.pick_type, post.games.home_team, post.games.away_team)}</Text>
            <Text style={styles.pickLine}>{formatPickLabel(post.pick_type, post.pick_line, post.pick_odds)}</Text>
          </View>
          {hasPickResult && (
            <View style={[styles.resultBadge, post.pick_result === "win" ? styles.resultWin : post.pick_result === "loss" ? styles.resultLoss : styles.resultPush]}>
              <Text style={styles.resultText}>{post.pick_result === "win" ? "W" : post.pick_result === "loss" ? "L" : "P"}</Text>
            </View>
          )}
        </Pressable>
      )}

      {/* Game tag */}
      {post.games && !post.pick_type && (
        <Pressable style={styles.gameTag} onPress={onGamePress}>
          {awayLogoSource ? (
            <Image source={awayLogoSource} style={styles.gameTagLogo} contentFit="contain" transition={0} />
          ) : (
            <View style={styles.gameTagLogoFallback}><Text style={styles.gameTagLogoLetter}>{post.games.away_team.split(" ").pop()?.[0]}</Text></View>
          )}
          <Text style={styles.gameTagTeam} numberOfLines={1}>{post.games.away_team}</Text>
          <Text style={styles.gameTagAt}>@</Text>
          {homeLogoSource ? (
            <Image source={homeLogoSource} style={styles.gameTagLogo} contentFit="contain" transition={0} />
          ) : (
            <View style={styles.gameTagLogoFallback}><Text style={styles.gameTagLogoLetter}>{post.games.home_team.split(" ").pop()?.[0]}</Text></View>
          )}
          <Text style={styles.gameTagTeam} numberOfLines={1}>{post.games.home_team}</Text>
          <ChevronRight size={14} color={colors.textMuted} />
        </Pressable>
      )}

      {/* Media */}
      {imageUrls.length > 0 && (
        <View style={styles.mediaContainer}>
          <ImageCarousel urls={imageUrls} onOpenLightbox={(i) => setLightboxIndex(i)} />
          <Lightbox
            urls={imageUrls.filter((u) => !/\.(mp4|mov|webm|m4v)/i.test(u) && !u.includes("video"))}
            startIndex={Math.max(0, lightboxIndex)}
            visible={lightboxIndex >= 0}
            onClose={() => setLightboxIndex(-1)}
          />
        </View>
      )}

      {/* Quoted post */}
      {post.quote_post && (
        <Pressable style={styles.quoteCard} onPress={() => onNavigate("PostDetail", { postId: post.quote_post!.id })}>
          <View style={styles.quoteHeader}>
            {quoteAvatarSource ? (
              <Image source={quoteAvatarSource} style={styles.quoteAvatar} contentFit="cover" transition={0} />
            ) : (
              <View style={styles.quoteAvatarFallback}><Text style={styles.quoteAvatarLetter}>{post.quote_post.profiles?.username?.[0]?.toUpperCase() || "?"}</Text></View>
            )}
            <Text style={styles.quoteName} numberOfLines={1}>{post.quote_post.profiles?.name || post.quote_post.profiles?.username || "user"}</Text>
          </View>
          {post.quote_post.content ? <MentionText text={post.quote_post.content} style={styles.quoteContent} numberOfLines={3} /> : null}
          {post.quote_post.image_url && parseImageUrls(post.quote_post.image_url).length > 0 && (
            <QuoteImage uri={parseImageUrls(post.quote_post.image_url)[0]} />
          )}
        </Pressable>
      )}
    </>
  );
}, (prev, next) => prev.post.id === next.post.id && prev.isOwn === next.isOwn);

function PostCard({ post, onNavigate, userId: user_id, focusKey }: PostCardProps) {
  const user = user_id ? { id: user_id } : null;

  const isOwn = user_id === post.user_id;
  const [deleted, setDeleted] = useState(false);

  const cached = getInteraction(post.id);
  const [liked, setLiked] = useState(cached?.liked ?? false);
  const [likeCount, setLikeCount] = useState(cached?.likeCount ?? post.likes_count);
  const [tailed, setTailed] = useState(cached?.tailed ?? false);
  const [tailCount, setTailCount] = useState(cached?.tailCount ?? post.tails_count);

  // Post menu state
  const [showPostMenu, setShowPostMenu] = useState(false);
  const postMenuAnim = useRef(new Animated.Value(0)).current;

  // Sync from cache when returning from PostDetail (focusKey changes on screen focus)
  useEffect(() => {
    const c = getInteraction(post.id);
    if (c) {
      setLiked(c.liked);
      setLikeCount(c.likeCount);
      setTailed(c.tailed);
      setTailCount(c.tailCount);
    }
  }, [post.id, focusKey]);

  // Tail Spin (quote post) state
  const [showTailSpin, setShowTailSpin] = useState(false);
  const [quoteContent, setQuoteContent] = useState("");
  const [quoteMediaUris, setQuoteMediaUris] = useState<string[]>([]);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);

  // Animations
  const hammerAnim = useRef(new Animated.Value(0)).current;
  const tailRotate = useRef(new Animated.Value(0)).current;
  const tailScale = useRef(new Animated.Value(1)).current;

  const playHammerStrike = useCallback(() => {
    hammerAnim.setValue(0);
    Animated.sequence([
      Animated.timing(hammerAnim, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.timing(hammerAnim, { toValue: 1, duration: 70, useNativeDriver: true }),
      Animated.timing(hammerAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start();
  }, [hammerAnim]);

  const playTailSpin = useCallback(() => {
    tailRotate.setValue(0);
    tailScale.setValue(1);
    Animated.parallel([
      Animated.timing(tailRotate, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(tailScale, { toValue: 1.3, duration: 250, useNativeDriver: true }),
        Animated.timing(tailScale, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]),
    ]).start();
  }, [tailRotate, tailScale]);

  const hammerRotation = hammerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "20deg"],
  });
  const tailRotation = tailRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

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
      setLikeCount((c) => { const n = Math.max(0, c - 1); setInteraction(post.id, { liked: false, likeCount: n, tailed, tailCount }); return n; });
      await supabase.from("likes").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      setLiked(true);
      setLikeCount((c) => { const n = c + 1; setInteraction(post.id, { liked: true, likeCount: n, tailed, tailCount }); return n; });
      playHammerStrike();
      await supabase.from("likes").insert({ post_id: post.id, user_id: user.id });
    }
  }, [liked, likeCount, tailed, tailCount, user, post.id]);

  // Simple tail (repost)
  const doTail = useCallback(async () => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (tailed) {
      setTailed(false);
      setTailCount((c) => { const n = Math.max(0, c - 1); setInteraction(post.id, { liked, likeCount, tailed: false, tailCount: n }); return n; });
      await supabase.from("tails").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      setTailed(true);
      setTailCount((c) => { const n = c + 1; setInteraction(post.id, { liked, likeCount, tailed: true, tailCount: n }); return n; });
      playTailSpin();
      await supabase.from("tails").insert({ post_id: post.id, user_id: user.id });
    }
  }, [tailed, liked, likeCount, tailCount, user, post.id]);

  // Tail Spin — pick media
  const pickQuoteMedia = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 4 - quoteMediaUris.length,
      quality: 0.8,
      exif: false,
    });
    if (!result.canceled) {
      const uris = result.assets.map((a) => a.uri);
      setQuoteMediaUris((prev) => [...prev, ...uris].slice(0, 4));
    }
  }, [quoteMediaUris.length]);

  // Tail Spin (quote post)
  const handleQuotePost = useCallback(async () => {
    if (!user || quoteSubmitting || !quoteContent.trim()) return;
    setQuoteSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let imageUrl: string | null = null;

    // Upload media if any
    if (quoteMediaUris.length > 0) {
      const urls: string[] = [];
      for (let uri of quoteMediaUris) {
        const fileName = uri.split("/").pop() || `${Date.now()}.jpg`;
        let ext = fileName.split(".").pop()?.toLowerCase() || "jpg";
        const isVideoFile = ext === "mp4" || ext === "mov" || ext === "webm" || ext === "m4v";

        if (!isVideoFile) {
          try {
            const manipulated = await ImageManipulator.manipulateAsync(uri, [], {
              compress: 0.85,
              format: ImageManipulator.SaveFormat.JPEG,
            });
            uri = manipulated.uri;
            ext = "jpg";
          } catch {}
        }

        const mimeType = isVideoFile ? `video/${ext}` : "image/jpeg";
        const path = `${user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

        try {
          const response = await fetch(uri);
          const arrayBuffer = await response.arrayBuffer();
          const { error: uploadErr } = await supabase.storage
            .from("post-media")
            .upload(path, arrayBuffer, { cacheControl: "3600", upsert: false, contentType: mimeType });

          if (!uploadErr) {
            const { data } = supabase.storage.from("post-media").getPublicUrl(path);
            urls.push(data.publicUrl);
          }
        } catch {}
      }
      if (urls.length === 1) imageUrl = urls[0];
      else if (urls.length > 1) imageUrl = JSON.stringify(urls);
    }

    const { error } = await supabase.from("posts").insert({
      user_id: user.id,
      content: quoteContent.trim(),
      image_url: imageUrl,
      quote_post_id: post.id,
    });

    if (!error) {
      if (!tailed) {
        await supabase.from("tails").insert({ post_id: post.id, user_id: user.id });
        setTailed(true);
        setTailCount((c) => c + 1);
      }
      setShowTailSpin(false);
      setQuoteContent("");
      setQuoteMediaUris([]);
    } else {
      Alert.alert("Error", "Failed to post");
    }
    setQuoteSubmitting(false);
  }, [user, quoteContent, quoteMediaUris, quoteSubmitting, post.id, tailed]);

  // Inline popover for tail options
  const [showTailMenu, setShowTailMenu] = useState(false);
  const tailMenuAnim = useRef(new Animated.Value(0)).current;

  const openTailMenu = useCallback(() => {
    setShowTailMenu(true);
    tailMenuAnim.setValue(0);
    Animated.spring(tailMenuAnim, { toValue: 1, tension: 300, friction: 20, useNativeDriver: true }).start();
  }, [tailMenuAnim]);

  const closeTailMenu = useCallback(() => {
    Animated.timing(tailMenuAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setShowTailMenu(false);
    });
  }, [tailMenuAnim]);

  const handleTail = useCallback(() => {
    if (!user) return;

    if (tailed) {
      doTail();
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    openTailMenu();
  }, [tailed, user, doTail, openTailMenu]);

  // Post menu handlers
  const openPostMenu = useCallback(() => {
    setShowPostMenu(true);
    postMenuAnim.setValue(0);
    Animated.spring(postMenuAnim, { toValue: 1, tension: 300, friction: 20, useNativeDriver: true }).start();
  }, [postMenuAnim]);

  const handleDelete = useCallback(() => {
    setShowPostMenu(false);
    Alert.alert("Delete Post", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          if (!user) return;
          const { error } = await supabase.from("posts").delete().eq("id", post.id).eq("user_id", user.id);
          if (!error) setDeleted(true);
        },
      },
    ]);
  }, [user, post.id]);

  const handlePin = useCallback(async () => {
    if (!user) return;
    setShowPostMenu(false);
    if (post.pinned_at) {
      await supabase.from("posts").update({ pinned_at: null }).eq("id", post.id).eq("user_id", user.id);
    } else {
      const { count } = await supabase.from("posts").select("id", { count: "exact", head: true }).eq("user_id", user.id).not("pinned_at", "is", null);
      if ((count ?? 0) >= 3) { Alert.alert("Limit", "You can only pin up to 3 posts"); return; }
      await supabase.from("posts").update({ pinned_at: new Date().toISOString() }).eq("id", post.id).eq("user_id", user.id);
    }
  }, [user, post.id, post.pinned_at]);

  const imageUrls = useMemo(() => parseImageUrls(post.image_url), [post.image_url]);
  const videoUrl = imageUrls.find((u) => /\.(mp4|mov|webm|m4v)/i.test(u) || u.includes("video"));
  const onPress = () => {
    if (videoUrl) {
      onNavigate("VideoPost", { postId: post.id, videoUrl });
    } else {
      onNavigate("PostDetail", { postId: post.id });
    }
  };

  if (deleted) return null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <PostBody post={post} onNavigate={onNavigate} isOwn={isOwn} onMenuPress={openPostMenu} />

      {/* Post menu popover */}
      {showPostMenu && (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setShowPostMenu(false)} />
          <Animated.View style={[
            styles.postMenu,
            {
              opacity: postMenuAnim,
              transform: [
                { scale: postMenuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                { translateY: postMenuAnim.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) },
              ],
            },
          ]}>
            <Pressable
              style={({ pressed }) => [styles.postMenuItem, pressed && styles.postMenuItemPressed]}
              onPress={handlePin}
            >
              <Text style={styles.postMenuText}>{post.pinned_at ? "Unpin post" : "Pin to profile"}</Text>
            </Pressable>
            <View style={styles.postMenuDivider} />
            <Pressable
              style={({ pressed }) => [styles.postMenuItem, pressed && styles.postMenuItemPressed]}
              onPress={handleDelete}
            >
              <Text style={styles.postMenuTextDanger}>Delete post</Text>
            </Pressable>
          </Animated.View>
        </>
      )}

      {/* Action bar */}
      <View style={styles.actions}>
        <Pressable onPress={handleLike} style={styles.actionBtn} hitSlop={8}>
          <Animated.View style={{ transform: [{ rotate: hammerRotation }] }}>
            <HammerIcon
              size={16}
              color={liked ? colors.emerald : colors.textMuted}
              filled={liked}
            />
          </Animated.View>
          <Text style={[styles.actionCount, liked && styles.actionActive]}>
            {likeCount > 0 ? String(likeCount) : ""}
          </Text>
        </Pressable>

        <View style={styles.actionDivider} />

        <View style={{ position: "relative" }}>
          <Pressable onPress={handleTail} style={styles.actionBtn} hitSlop={8}>
            <Animated.View style={{ transform: [{ rotate: tailRotation }, { scale: tailScale }] }}>
              <TailIcon
                size={16}
                color={tailed ? colors.emerald : colors.textMuted}
              />
            </Animated.View>
            <Text style={[styles.actionCount, tailed && styles.actionActive]}>
              {tailCount > 0 ? String(tailCount) : ""}
            </Text>
          </Pressable>

          {/* Tail popover */}
          {showTailMenu && (
            <>
              <Pressable style={styles.tailMenuBackdrop} onPress={closeTailMenu} />
              <Animated.View style={[
                styles.tailMenu,
                {
                  opacity: tailMenuAnim,
                  transform: [
                    { scale: tailMenuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                    { translateY: tailMenuAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
                  ],
                },
              ]}>
                <Pressable
                  style={({ pressed }) => [styles.tailMenuItem, pressed && styles.tailMenuItemPressed]}
                  onPress={() => { setShowTailMenu(false); setTimeout(doTail, 50); }}
                >
                  <TailIcon size={15} color={colors.textSecondary} />
                  <Text style={styles.tailMenuText}>Tail</Text>
                </Pressable>
                <View style={styles.tailMenuDivider} />
                <Pressable
                  style={({ pressed }) => [styles.tailMenuItem, pressed && styles.tailMenuItemPressed]}
                  onPress={() => { setShowTailMenu(false); setTimeout(() => setShowTailSpin(true), 50); }}
                >
                  <CommentIcon size={15} color={colors.textSecondary} />
                  <Text style={styles.tailMenuText}>Tail Spin</Text>
                </Pressable>
              </Animated.View>
            </>
          )}
        </View>

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
            {/* Toolbar: media + char count */}
            <View style={tsStyles.toolbar}>
              <Pressable style={tsStyles.mediaBtn} onPress={pickQuoteMedia} disabled={quoteMediaUris.length >= 4}>
                <ImageIcon size={18} color={quoteMediaUris.length >= 4 ? colors.textDim : colors.textMuted} />
                <Text style={[tsStyles.mediaBtnText, quoteMediaUris.length >= 4 && { color: colors.textDim }]}>
                  {quoteMediaUris.length > 0 ? `${quoteMediaUris.length}/4` : "Media"}
                </Text>
              </Pressable>
              <Text style={tsStyles.charCount}>{quoteContent.length}/280</Text>
            </View>

            {/* Media previews */}
            {quoteMediaUris.length > 0 && (
              <View style={tsStyles.mediaPreviews}>
                {quoteMediaUris.map((uri, i) => (
                  <View key={i} style={tsStyles.mediaThumb}>
                    <Image source={{ uri }} style={tsStyles.mediaThumbImg} contentFit="cover" />
                    <Pressable
                      style={tsStyles.mediaRemove}
                      onPress={() => setQuoteMediaUris((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <CloseIcon size={10} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

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
                <MentionText text={post.content} style={tsStyles.previewContent} numberOfLines={3} />
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

export default React.memo(PostCard, (prev, next) => prev.post.id === next.post.id && prev.userId === next.userId && prev.post.likes_count === next.post.likes_count && prev.post.tails_count === next.post.tails_count && prev.post.comments_count === next.post.comments_count && prev.focusKey === next.focusKey);

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
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  mediaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  mediaBtnText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: "600",
  },
  charCount: {
    fontSize: 10,
    color: colors.textDim,
  },
  mediaPreviews: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  mediaThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    overflow: "hidden",
    position: "relative",
  },
  mediaThumbImg: {
    width: 56,
    height: 56,
  },
  mediaRemove: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
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
    height: 140,
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

  // 3-dot menu button
  menuBtn: { padding: 4, marginLeft: 4 },

  // Post menu popover
  menuBackdrop: {
    position: "absolute",
    top: -500,
    bottom: -500,
    left: -500,
    right: -500,
    zIndex: 10,
  },
  postMenu: {
    position: "absolute",
    top: 40,
    right: spacing.md,
    width: 160,
    backgroundColor: "#27272a",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#3f3f46",
    zIndex: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    borderCurve: "continuous",
  },
  postMenuItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  postMenuItemPressed: { backgroundColor: "#3f3f46" },
  postMenuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#3f3f46" },
  postMenuText: { fontSize: fontSize.sm, color: colors.text, fontWeight: "500" },
  postMenuTextDanger: { fontSize: fontSize.sm, color: "#f87171", fontWeight: "500" },

  // Tail popover
  tailMenuBackdrop: {
    position: "absolute",
    top: -500,
    bottom: -500,
    left: -500,
    right: -500,
    zIndex: 10,
  },
  tailMenu: {
    position: "absolute",
    bottom: "100%",
    left: "50%",
    marginLeft: -75,
    marginBottom: 6,
    width: 150,
    backgroundColor: "#27272a",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#3f3f46",
    zIndex: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  tailMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  tailMenuItemPressed: {
    backgroundColor: "#3f3f46",
  },
  tailMenuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#3f3f46",
  },
  tailMenuText: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: "500",
  },
});

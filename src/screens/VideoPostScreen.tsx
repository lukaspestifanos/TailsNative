import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  GestureResponderEvent,
  LayoutChangeEvent,
  Alert,
  Share,
  Animated as RNAnimated,
} from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Svg, { Path } from "react-native-svg";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { colors, fontSize, spacing } from "../lib/theme";
import { timeAgo } from "../lib/formatters";
import { HammerIcon, TailIcon, CommentIcon } from "../components/Icons";

const { width: SW, height: SH } = Dimensions.get("window");

type Route = RouteProp<RootStackParamList, "VideoPost">;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function VideoPostScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [post, setPost] = useState<any>(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [tailed, setTailed] = useState(false);
  const [tailCount, setTailCount] = useState(0);
  const [commentsCount, setCommentsCount] = useState(0);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [bottomHeight, setBottomHeight] = useState(200);

  // Seek bar state
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const seekBarWidth = useRef(0);
  const seekBarX = useRef(0);
  const seekBarRef = useRef<View>(null);

  const player = useVideoPlayer(params.videoUrl, (p) => {
    p.loop = true;
    p.muted = false;
  });

  useEffect(() => {
    const t = setTimeout(() => player.play(), 100);
    return () => clearTimeout(t);
  }, []);

  // Poll playback progress
  useEffect(() => {
    const interval = setInterval(() => {
      if (isSeeking) return;
      const dur = player.duration;
      const cur = player.currentTime;
      if (dur > 0) {
        setDuration(dur);
        setProgress(cur / dur);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [player, isSeeking]);

  const handleSeek = useCallback((evt: GestureResponderEvent) => {
    if (duration <= 0 || seekBarWidth.current <= 0) return;
    const touchX = evt.nativeEvent.pageX - seekBarX.current;
    const clamped = Math.max(0, Math.min(touchX, seekBarWidth.current));
    const ratio = clamped / seekBarWidth.current;
    setProgress(ratio);
    player.currentTime = ratio * duration;
  }, [duration, player]);

  const onSeekBarLayout = useCallback((e: LayoutChangeEvent) => {
    seekBarWidth.current = e.nativeEvent.layout.width;
    seekBarRef.current?.measureInWindow((x) => {
      seekBarX.current = x;
    });
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    async function load() {
      const { data: postData } = await supabase
        .from("posts")
        .select("id, user_id, content, created_at")
        .eq("id", params.postId)
        .single();
      if (!postData) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, name, avatar_url")
        .eq("id", postData.user_id)
        .single();

      setPost({ ...postData, profiles: profile });

      const [likesRes, tailsRes, commentsRes] = await Promise.all([
        supabase.from("likes").select("*", { count: "exact", head: true }).eq("post_id", params.postId),
        supabase.from("tails").select("*", { count: "exact", head: true }).eq("post_id", params.postId),
        supabase.from("comments").select("*", { count: "exact", head: true }).eq("post_id", params.postId),
      ]);
      setLikeCount(likesRes.count ?? 0);
      setTailCount(tailsRes.count ?? 0);
      setCommentsCount(commentsRes.count ?? 0);

      if (user) {
        const [l, t] = await Promise.all([
          supabase.from("likes").select("id").eq("post_id", params.postId).eq("user_id", user.id).maybeSingle(),
          supabase.from("tails").select("id").eq("post_id", params.postId).eq("user_id", user.id).maybeSingle(),
        ]);
        setLiked(!!l.data);
        setTailed(!!t.data);
      }
    }
    load();
  }, [params.postId]);

  const handleLike = useCallback(async () => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (liked) {
      setLiked(false); setLikeCount((c) => c - 1);
      await supabase.from("likes").delete().eq("post_id", params.postId).eq("user_id", user.id);
    } else {
      setLiked(true); setLikeCount((c) => c + 1);
      await supabase.from("likes").insert({ post_id: params.postId, user_id: user.id });
    }
  }, [liked, user]);

  const handleTail = useCallback(async () => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (tailed) {
      setTailed(false); setTailCount((c) => c - 1);
      await supabase.from("tails").delete().eq("post_id", params.postId).eq("user_id", user.id);
    } else {
      setTailed(true); setTailCount((c) => c + 1);
      await supabase.from("tails").insert({ post_id: params.postId, user_id: user.id });
    }
  }, [tailed, user]);

  // 3-dot menu
  const [showMenu, setShowMenu] = useState(false);
  const menuAnim = useRef(new RNAnimated.Value(0)).current;
  const isOwn = post?.user_id === user?.id;

  const openMenu = useCallback(() => {
    setShowMenu(true);
    menuAnim.setValue(0);
    RNAnimated.spring(menuAnim, { toValue: 1, tension: 300, friction: 20, useNativeDriver: true }).start();
  }, [menuAnim]);

  const handleShare = useCallback(async () => {
    setShowMenu(false);
    try {
      await Share.share({ url: `https://www.tails.social/post/${params.postId}`, message: `https://www.tails.social/post/${params.postId}` });
    } catch {}
  }, [params.postId]);

  const handleDelete = useCallback(() => {
    setShowMenu(false);
    Alert.alert("Delete Post", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          if (!user) return;
          await supabase.from("posts").delete().eq("id", params.postId).eq("user_id", user.id);
          navigation.goBack();
        },
      },
    ]);
  }, [user, params.postId, navigation]);

  const togglePlayPause = () => {
    if (paused) { player.play(); setPaused(false); }
    else { player.pause(); setPaused(true); }
  };

  const toggleMute = () => {
    const next = !muted;
    player.muted = next;
    setMuted(next);
  };

  return (
    <View style={styles.container}>
      {/* VIDEO — full screen, edge to edge, IS the background */}
      <Pressable style={StyleSheet.absoluteFill} onPress={togglePlayPause}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
        />
      </Pressable>

      {/* Gradient overlays for readability */}
      <View style={styles.gradientTop} pointerEvents="none" />

      {/* Pause icon — center of screen */}
      {paused && (
        <View style={styles.pauseCenter} pointerEvents="none">
          <Svg width={56} height={56} viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)">
            <Path d="M8 5v14l11-7z" />
          </Svg>
        </View>
      )}

      {/* TOP — back + more, over the video */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={() => navigation.goBack()} hitSlop={16} style={styles.topBtn}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round">
            <Path d="M19 12H5M12 19l-7-7 7-7" />
          </Svg>
        </Pressable>
        <Pressable onPress={openMenu} hitSlop={16} style={styles.topBtn}>
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="#fff">
            <Path d="M12 8a2 2 0 110-4 2 2 0 010 4zM12 14a2 2 0 110-4 2 2 0 010 4zM12 20a2 2 0 110-4 2 2 0 010 4z" />
          </Svg>
        </Pressable>
      </View>

      {/* 3-dot menu overlay */}
      {showMenu && (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setShowMenu(false)} />
          <RNAnimated.View style={[
            styles.menu,
            { top: insets.top + 8 + 44 },
            {
              opacity: menuAnim,
              transform: [
                { scale: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
                { translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) },
              ],
            },
          ]}>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              onPress={handleShare}
            >
              <Text style={styles.menuText}>Share</Text>
            </Pressable>
            {isOwn && (
              <>
                <View style={styles.menuDivider} />
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  onPress={handleDelete}
                >
                  <Text style={styles.menuTextDanger}>Delete post</Text>
                </Pressable>
              </>
            )}
          </RNAnimated.View>
        </>
      )}

      {/* BOTTOM — author, caption, actions, controls — all over the video */}
      <View
        style={[styles.bottomOverlay, { paddingBottom: insets.bottom + 12 }]}
        pointerEvents="box-none"
        onLayout={(e) => setBottomHeight(e.nativeEvent.layout.height)}
      >
        {/* Author + caption */}
        {post && (
          <View style={styles.postInfo}>
            <Pressable
              style={styles.authorRow}
              onPress={() => post.profiles?.username && navigation.navigate("UserProfile", { username: post.profiles.username })}
            >
              {post.profiles?.avatar_url ? (
                <Image source={{ uri: post.profiles.avatar_url }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarLetter}>{post.profiles?.username?.[0]?.toUpperCase() || "?"}</Text>
                </View>
              )}
              <View>
                <Text style={styles.name} numberOfLines={1}>
                  {post.profiles?.name || post.profiles?.username || "anonymous"}
                </Text>
                <Text style={styles.username}>@{post.profiles?.username || "user"}</Text>
              </View>
              <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
            </Pressable>

            {post.content ? (
              <Text style={styles.caption} numberOfLines={3}>{post.content}</Text>
            ) : null}
          </View>
        )}

        {/* Actions — hammer, tail, comment */}
        <View style={styles.actions}>
          <Pressable onPress={handleLike} style={styles.actionBtn} hitSlop={8}>
            <HammerIcon size={22} color={liked ? colors.emerald : "#fff"} filled={liked} />
            {likeCount > 0 && <Text style={[styles.actionCount, liked && styles.activeCount]}>{likeCount}</Text>}
          </Pressable>

          <Pressable onPress={handleTail} style={styles.actionBtn} hitSlop={8}>
            <TailIcon size={22} color={tailed ? colors.emerald : "#fff"} />
            {tailCount > 0 && <Text style={[styles.actionCount, tailed && styles.activeCount]}>{tailCount}</Text>}
          </Pressable>

          <Pressable onPress={() => navigation.navigate("PostDetail", { postId: params.postId })} style={styles.actionBtn} hitSlop={8}>
            <CommentIcon size={22} color="#fff" />
            {commentsCount > 0 && <Text style={styles.actionCount}>{commentsCount}</Text>}
          </Pressable>
        </View>

        {/* Controls — play/pause left, mute right */}
        <View style={styles.controls}>
          <Pressable onPress={togglePlayPause} hitSlop={12}>
            {paused ? (
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="#fff">
                <Path d="M8 5v14l11-7z" />
              </Svg>
            ) : (
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="#fff">
                <Path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </Svg>
            )}
          </Pressable>

          {/* Seek bar */}
          <View
            ref={seekBarRef}
            style={styles.seekBar}
            onLayout={onSeekBarLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(e) => { setIsSeeking(true); handleSeek(e); }}
            onResponderMove={handleSeek}
            onResponderRelease={(e) => { handleSeek(e); setIsSeeking(false); }}
          >
            <View style={styles.seekTrack}>
              <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
            </View>
            <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
          </View>

          {duration > 0 && (
            <Text style={styles.timeText}>
              {formatTime(progress * duration)}/{formatTime(duration)}
            </Text>
          )}

          <Pressable onPress={toggleMute} hitSlop={12}>
            {muted ? (
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
                <Path d="M11 5L6 9H2v6h4l5 4V5z" />
                <Path d="M23 9l-6 6M17 9l6 6" />
              </Svg>
            ) : (
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
                <Path d="M11 5L6 9H2v6h4l5 4V5z" />
                <Path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
              </Svg>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },

  // Gradient overlays for text readability over video
  gradientTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: "transparent",
    // Fake gradient with layered opacity
    borderBottomWidth: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 60 },
    shadowOpacity: 0.8,
    shadowRadius: 40,
  },
  gradientBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
  },

  // Pause overlay center
  pauseCenter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },

  // Top bar — over video
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    zIndex: 10,
  },
  topBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Bottom overlay — over video
  bottomOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    zIndex: 10,
  },

  // Post info
  postInfo: {
    marginBottom: spacing.md,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: { color: "#fff", fontSize: 15, fontWeight: "700" },
  name: {
    fontSize: fontSize.md,
    fontWeight: "800",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  username: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: "rgba(255,255,255,0.85)",
    marginTop: 1,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  time: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: "rgba(255,255,255,0.7)",
    marginLeft: "auto",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  caption: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: "#fff",
    lineHeight: 22,
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  // Actions
  actions: {
    flexDirection: "row",
    gap: spacing.xxl,
    marginBottom: spacing.md,
  },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionCount: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  activeCount: { color: colors.emerald },

  // Controls bar
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },

  // Seek bar
  seekBar: {
    flex: 1,
    height: 28,
    justifyContent: "center",
  },
  seekTrack: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 1.5,
    overflow: "hidden",
  },
  seekFill: {
    height: 3,
    backgroundColor: "#fff",
    borderRadius: 1.5,
  },
  seekThumb: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#fff",
    marginLeft: -6,
    top: 8,
  },
  timeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "rgba(255,255,255,0.7)",
    fontVariant: ["tabular-nums"],
    minWidth: 38,
  },

  // 3-dot menu
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  menu: {
    position: "absolute",
    right: spacing.lg,
    zIndex: 60,
    backgroundColor: "rgba(24,24,27,0.95)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(63,63,70,0.6)",
    minWidth: 160,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  menuItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuItemPressed: { backgroundColor: "rgba(63,63,70,0.5)" },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(63,63,70,0.6)" },
  menuText: { fontSize: 14, color: "#fff", fontWeight: "500" },
  menuTextDanger: { fontSize: 14, color: "#f87171", fontWeight: "500" },
});

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  FlatList,
  Dimensions,
  Animated,
  PanResponder,
  ActivityIndicator,
  Easing,
} from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { colors, radius, spacing, fontSize } from "../lib/theme";
import { isVideo } from "../lib/parseImageUrls";

const SCREEN = Dimensions.get("window");

// ─── Video Player ───
// Mirrors web's VideoPreview behavior:
// - Auto-play muted, loop
// - Tap: paused → play unmuted / muted → unmute / unmuted → pause
// - Play overlay when paused, mute badge when playing

// Mute/unmute badge used by both inline and detail video
function MuteBadge({ muted, onPress }: { muted: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.muteBadge} hitSlop={10}>
      {muted ? (
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
          <Path d="M11 5L6 9H2v6h4l5 4V5z" />
          <Path d="M23 9l-6 6M17 9l6 6" />
        </Svg>
      ) : (
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
          <Path d="M11 5L6 9H2v6h4l5 4V5z" />
          <Path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
        </Svg>
      )}
    </Pressable>
  );
}

// Shared video component — sizes to natural aspect ratio like the web's <video> element.
// Web: inline-block container, video determines its own size, max-h-72, object-cover.
// Native: we render at full card width initially, then VideoView fills it.
// No fixed height crop — the video shows at its natural ratio.
// Feed inline video — autoplay muted, loop, no tap handler (PostCard handles navigation).
// Video shows at its natural aspect ratio (like the web's inline-block <video>).
// No fixed height — the video determines its own size. Only capped at max-h if very tall.
export function VideoPreview({ url }: { url: string }) {
  const [muted, setMuted] = useState(true);
  const [ratio, setRatio] = useState(1); // default square until we know
  const cardWidth = SCREEN.width - spacing.sm * 2 - spacing.md * 2;

  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    const t = setTimeout(() => player.play(), 100);
    return () => clearTimeout(t);
  }, []);

  // Get natural video dimensions via the VideoView's onLayout or player events
  // expo-video doesn't expose naturalSize reliably, so use onReadyForDisplay
  const handleVideoLayout = useCallback((e: any) => {
    try {
      const { naturalSize } = e.nativeEvent || {};
      if (naturalSize?.width && naturalSize?.height) {
        setRatio(naturalSize.width / naturalSize.height);
      }
    } catch {}
  }, []);

  // Height from natural ratio, but cap very tall videos at 500px
  const naturalHeight = Math.round(cardWidth / ratio);
  const height = Math.min(naturalHeight, 500);

  return (
    <View style={[styles.videoWrap, { width: cardWidth, height }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <MuteBadge muted={muted} onPress={() => { const next = !muted; player.muted = next; setMuted(next); }} />
    </View>
  );
}

// Post detail video — same approach, unmuted
export function DetailVideoPlayer({ url }: { url: string }) {
  const [muted, setMuted] = useState(false);
  const [ratio, setRatio] = useState(1);
  const cardWidth = SCREEN.width - spacing.sm * 2 - spacing.md * 2;

  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = false;
  });

  useEffect(() => {
    const t = setTimeout(() => player.play(), 100);
    return () => clearTimeout(t);
  }, []);

  const naturalHeight = Math.round(cardWidth / ratio);
  const height = Math.min(naturalHeight, 600);

  return (
    <View style={[styles.videoWrap, { width: cardWidth, height }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <MuteBadge muted={muted} onPress={() => { const next = !muted; player.muted = next; setMuted(next); }} />
    </View>
  );
}

// ─── Skeleton shimmer placeholder ───

function ImageSkeleton({ width, height }: { width: number; height: number }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const opacity = shimmer.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 0.6, 0.3],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width, height, borderRadius: radius.lg, opacity },
      ]}
    />
  );
}

// ─── Single image that measures its own aspect ratio ───

// Matches web's max-h-72 (288px) + object-contain
// Image is fully visible (no crop), capped at 288px so it doesn't eat the feed
const MAX_IMAGE_HEIGHT = 288;

function AspectImage({
  uri,
  onPress,
}: {
  uri: string;
  onPress?: () => void;
}) {
  const cardWidth = SCREEN.width - spacing.sm * 2 - spacing.md * 2;
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const { Image: RNImage } = require("react-native");
    RNImage.getSize(
      uri,
      (w: number, h: number) => {
        const natural = Math.round(cardWidth * (h / w));
        if (natural > MAX_IMAGE_HEIGHT) {
          setDims({ w: Math.round(MAX_IMAGE_HEIGHT / (h / w)), h: MAX_IMAGE_HEIGHT });
        } else {
          setDims({ w: cardWidth, h: natural });
        }
      },
      () => setDims({ w: cardWidth, h: MAX_IMAGE_HEIGHT })
    );
  }, [uri]);

  const imgWidth = dims?.w ?? cardWidth;
  const height = dims?.h ?? 200;

  if (!dims) {
    return <ImageSkeleton width={cardWidth} height={200} />;
  }

  return (
    <Pressable onPress={onPress} style={[styles.aspectWrap, { width: imgWidth, alignSelf: "flex-start" }]}>
      <Image
        source={{ uri }}
        style={[styles.aspectImage, { height, width: imgWidth }]}
        contentFit="contain"
        transition={200}
      />
    </Pressable>
  );
}

// ─── Image Carousel ───

interface ImageCarouselProps {
  urls: string[];
  onOpenLightbox?: (index: number) => void;
}

export function ImageCarousel({ urls, onOpenLightbox }: ImageCarouselProps) {
  const [current, setCurrent] = useState(0);
  const count = urls.length;

  if (count === 0) return null;

  // Single
  if (count === 1) {
    const url = urls[0];
    if (isVideo(url)) return <VideoPreview url={url} />;
    return <AspectImage uri={url} onPress={() => onOpenLightbox?.(0)} />;
  }

  // Two — side by side
  if (count === 2) {
    return (
      <View style={styles.dualRow}>
        {urls.map((url, i) => (
          <View key={i} style={styles.dualItem}>
            {isVideo(url) ? (
              <VideoPreview url={url} />
            ) : (
              <Pressable onPress={() => onOpenLightbox?.(i)}>
                <Image
                  source={{ uri: url }}
                  style={styles.dualImage}
                  contentFit="cover"
                  transition={200}
                />
              </Pressable>
            )}
          </View>
        ))}
      </View>
    );
  }

  // 3+ — paging scroll
  const cardWidth = SCREEN.width - spacing.sm * 2 - spacing.md * 2;

  return (
    <View>
      <FlatList
        data={urls}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + 8}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => {
          setCurrent(Math.round(e.nativeEvent.contentOffset.x / (cardWidth + 8)));
        }}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index }) =>
          isVideo(item) ? (
            <View style={{ width: cardWidth, marginRight: 8 }}>
              <VideoPreview url={item} />
            </View>
          ) : (
            <Pressable
              onPress={() => onOpenLightbox?.(index)}
              style={{ width: cardWidth, marginRight: 8 }}
            >
              <Image
                source={{ uri: item }}
                style={[styles.carouselImage, { width: cardWidth }]}
                contentFit="cover"
                transition={200}
              />
            </Pressable>
          )
        }
      />
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{current + 1}/{count}</Text>
      </View>
      <View style={styles.dots}>
        {urls.map((_, i) => (
          <View key={i} style={[styles.dot, i === current && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

// ─── Fullscreen Lightbox — iOS Photos style ───

interface LightboxProps {
  urls: string[];
  startIndex: number;
  visible: boolean;
  onClose: () => void;
}

export function Lightbox({ urls, startIndex, visible, onClose }: LightboxProps) {
  const [current, setCurrent] = useState(startIndex);
  const insets = useSafeAreaInsets();
  const count = urls.length;

  // Reset to startIndex when opened
  useEffect(() => {
    if (visible) setCurrent(startIndex);
  }, [visible, startIndex]);

  // Swipe-to-dismiss gesture
  const pan = useRef(new Animated.Value(0)).current;
  const bgOpacity = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 15 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        pan.setValue(g.dy);
        bgOpacity.setValue(1 - Math.min(Math.abs(g.dy) / 300, 0.6));
      },
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dy) > 150 || Math.abs(g.vy) > 0.8) {
          const dest = g.dy > 0 ? SCREEN.height : -SCREEN.height;
          Animated.parallel([
            Animated.timing(pan, { toValue: dest, duration: 200, useNativeDriver: true }),
            Animated.timing(bgOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => {
            pan.setValue(0);
            bgOpacity.setValue(1);
            onClose();
          });
        } else {
          Animated.spring(pan, { toValue: 0, useNativeDriver: true, tension: 60 }).start();
          Animated.timing(bgOpacity, { toValue: 1, duration: 100, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const onScroll = useCallback((e: any) => {
    setCurrent(Math.round(e.nativeEvent.contentOffset.x / SCREEN.width));
  }, []);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.lbBg, { opacity: bgOpacity }]} />

      {/* Close */}
      <Pressable style={[styles.lbClose, { top: insets.top + 12 }]} onPress={onClose} hitSlop={16}>
        <Svg width={18} height={18} viewBox="0 0 24 24" stroke="#fff" strokeWidth={2.5} strokeLinecap="round">
          <Path d="M18 6L6 18M6 6l12 12" />
        </Svg>
      </Pressable>

      {/* Counter */}
      {count > 1 && (
        <View style={[styles.lbCounter, { top: insets.top + 16 }]}>
          <Text style={styles.lbCounterText}>{current + 1} / {count}</Text>
        </View>
      )}

      {/* Tap anywhere to close */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

      {/* Images — swipe to dismiss + swipe between */}
      <Animated.View style={[styles.lbContent, { transform: [{ translateY: pan }] }]} {...panResponder.panHandlers}>
        <FlatList
          data={urls}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: SCREEN.width, offset: SCREEN.width * i, index: i })}
          onMomentumScrollEnd={onScroll}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <Pressable style={styles.lbSlide} onPress={onClose}>
              <Image source={{ uri: item }} style={styles.lbImage} contentFit="contain" />
            </Pressable>
          )}
        />
      </Animated.View>

      {/* Dots */}
      {count > 1 && (
        <View style={[styles.lbDots, { bottom: insets.bottom + 20 }]}>
          {urls.map((_, i) => (
            <View key={i} style={[styles.lbDot, i === current && styles.lbDotActive]} />
          ))}
        </View>
      )}
    </Modal>
  );
}

export { ImageSkeleton };

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.cardHover,
  },
  videoWrap: {
    alignSelf: "flex-start",
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "transparent",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(63, 63, 70, 0.6)",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
    paddingLeft: 3, // visual center for play triangle
  },
  muteBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Aspect image
  aspectWrap: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  aspectImage: {
    width: "100%",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(63, 63, 70, 0.6)", // zinc-700/60 — matches web
  },
  loadingOverlay: {
    backgroundColor: colors.cardHover,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radius.lg,
  },

  // Dual
  dualRow: { flexDirection: "row", gap: 4 },
  dualItem: { flex: 1 },
  dualImage: {
    width: "100%",
    height: 200,
    borderRadius: radius.md,
    backgroundColor: colors.cardHover,
  },

  // Carousel
  carouselImage: {
    height: 240,
    borderRadius: radius.lg,
    backgroundColor: colors.cardHover,
  },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 100,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
    marginTop: 8,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)" },
  dotActive: { backgroundColor: "#fff" },

  // Lightbox
  lbBg: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000" },
  lbContent: { flex: 1, justifyContent: "center" },
  lbClose: {
    position: "absolute",
    right: 16,
    zIndex: 20,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(39,39,42,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  lbCounter: {
    position: "absolute",
    alignSelf: "center",
    zIndex: 20,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  lbCounterText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  lbSlide: { width: SCREEN.width, justifyContent: "center", alignItems: "center" },
  lbImage: { width: SCREEN.width, height: SCREEN.height * 0.75 },
  lbDots: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
    zIndex: 20,
  },
  lbDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.35)" },
  lbDotActive: { backgroundColor: "#fff" },
});

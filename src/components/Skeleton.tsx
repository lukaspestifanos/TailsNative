import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, ViewStyle } from "react-native";
import { colors, radius, spacing } from "../lib/theme";

// Shimmer skeleton matching web's .skeleton class:
// background: linear-gradient(90deg, #27272a 25%, #3f3f46 50%, #27272a 75%)

function Bone({ style }: { style?: ViewStyle }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const translateX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  return (
    <View style={[styles.bone, style]}>
      <Animated.View
        style={[
          styles.shimmer,
          { transform: [{ translateX }] },
        ]}
      />
    </View>
  );
}

// Feed skeleton — matches web's FeedLoader loading state
export function FeedSkeleton() {
  return (
    <View style={styles.feed}>
      {[0, 1, 2, 3].map((i) => (
        <PostSkeleton key={i} />
      ))}
    </View>
  );
}

// Single post card skeleton — matches web's SlipCard skeleton
export function PostSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Bone style={styles.avatarBone} />
        <Bone style={styles.nameBone} />
        <Bone style={styles.timeBone} />
      </View>
      <Bone style={styles.line1} />
      <Bone style={styles.line2} />
    </View>
  );
}

// Post detail skeleton — matches web's PostPageClient loading state
export function PostDetailSkeleton() {
  return (
    <View style={styles.detail}>
      {/* Author */}
      <View style={styles.detailAuthor}>
        <Bone style={styles.detailAvatar} />
        <View style={{ flex: 1, gap: 6 }}>
          <Bone style={styles.detailName} />
          <Bone style={styles.detailUsername} />
        </View>
      </View>
      {/* Content lines */}
      <Bone style={styles.detailLine1} />
      <Bone style={styles.detailLine2} />
      <Bone style={styles.detailLine3} />
      {/* Image placeholder */}
      <Bone style={styles.detailImage} />
      {/* Timestamp */}
      <Bone style={styles.detailTimestamp} />
      {/* Stats */}
      <View style={styles.detailStats}>
        <Bone style={styles.detailStat} />
        <Bone style={styles.detailStat} />
        <Bone style={styles.detailStat} />
      </View>
      {/* Comments */}
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.commentSkeleton}>
          <Bone style={styles.commentAvatar} />
          <View style={{ flex: 1, gap: 6 }}>
            <Bone style={styles.commentName} />
            <Bone style={styles.commentLine1} />
            <Bone style={styles.commentLine2} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bone: {
    backgroundColor: colors.skeleton1,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  shimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.skeleton2,
    opacity: 0.5,
    width: 200,
  },

  // Feed
  feed: { paddingVertical: spacing.xs },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.sm,
    marginVertical: spacing.xs,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  avatarBone: { width: 28, height: 28, borderRadius: 14 },
  nameBone: { width: 96, height: 12, borderRadius: 4 },
  timeBone: { width: 32, height: 12, borderRadius: 4, marginLeft: "auto" },
  line1: { width: "100%", height: 12, borderRadius: 4, marginBottom: 8 },
  line2: { width: "75%", height: 12, borderRadius: 4 },

  // Post detail
  detail: { padding: spacing.lg },
  detailAuthor: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  detailAvatar: { width: 44, height: 44, borderRadius: 22 },
  detailName: { width: 112, height: 16, borderRadius: 4 },
  detailUsername: { width: 80, height: 12, borderRadius: 4 },
  detailLine1: { width: "100%", height: 16, borderRadius: 4, marginBottom: 8 },
  detailLine2: { width: "80%", height: 16, borderRadius: 4, marginBottom: 8 },
  detailLine3: { width: "50%", height: 16, borderRadius: 4, marginBottom: spacing.lg },
  detailImage: { width: "100%", height: 192, borderRadius: radius.lg, marginBottom: spacing.lg },
  detailTimestamp: { width: 96, height: 12, borderRadius: 4, marginBottom: spacing.lg },
  detailStats: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginBottom: spacing.md,
  },
  detailStat: { width: 80, height: 12, borderRadius: 4 },
  commentSkeleton: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  commentAvatar: { width: 32, height: 32, borderRadius: 16 },
  commentName: { width: 112, height: 12, borderRadius: 4 },
  commentLine1: { width: "100%", height: 12, borderRadius: 4 },
  commentLine2: { width: "66%", height: 12, borderRadius: 4 },
});

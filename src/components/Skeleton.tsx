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

// Profile skeleton — matches UserProfileScreen header + tabs + post placeholders
export function ProfileSkeleton() {
  return (
    <View style={profileStyles.container}>
      {/* Header: avatar + info */}
      <View style={profileStyles.header}>
        <View style={profileStyles.avatarCol}>
          <Bone style={profileStyles.avatar} />
          <Bone style={profileStyles.activityBone} />
        </View>
        <View style={profileStyles.infoCol}>
          <Bone style={profileStyles.nameBone} />
          <Bone style={profileStyles.usernameBone} />
          <View style={profileStyles.statsRow}>
            <Bone style={profileStyles.statBone} />
            <Bone style={profileStyles.statBone} />
            <Bone style={profileStyles.statBone} />
          </View>
          <Bone style={profileStyles.recordBone} />
        </View>
      </View>

      {/* Bio */}
      <View style={profileStyles.bioWrap}>
        <Bone style={profileStyles.bioLine1} />
        <Bone style={profileStyles.bioLine2} />
      </View>

      {/* Follow button */}
      <View style={profileStyles.btnWrap}>
        <Bone style={profileStyles.followBone} />
      </View>

      {/* Tabs */}
      <View style={profileStyles.tabs}>
        {[72, 52, 62, 72, 48].map((w, i) => (
          <Bone key={i} style={{ width: w, height: 12, borderRadius: 4 }} />
        ))}
      </View>

      {/* Post placeholders */}
      {[0, 1, 2].map((i) => (
        <PostSkeleton key={i} />
      ))}
    </View>
  );
}

const profileStyles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  avatarCol: { alignItems: "center", gap: 6 },
  avatar: { width: 76, height: 76, borderRadius: 38 },
  activityBone: { width: 52, height: 8, borderRadius: 4 },
  infoCol: { flex: 1, paddingTop: 4, gap: 8 },
  nameBone: { width: 120, height: 18, borderRadius: 4 },
  usernameBone: { width: 80, height: 12, borderRadius: 4 },
  statsRow: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  statBone: { width: 60, height: 12, borderRadius: 4 },
  recordBone: { width: 56, height: 12, borderRadius: 4 },
  bioWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: 6 },
  bioLine1: { width: "90%", height: 12, borderRadius: 4 },
  bioLine2: { width: "60%", height: 12, borderRadius: 4 },
  btnWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  followBone: { width: "100%", height: 36, borderRadius: radius.md },
  tabs: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

// Messages list skeleton — matches conversation rows
export function MessagesSkeleton() {
  return (
    <View style={messagesStyles.container}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={messagesStyles.row}>
          <Bone style={messagesStyles.avatar} />
          <View style={messagesStyles.content}>
            <View style={messagesStyles.topRow}>
              <Bone style={{ width: 100 + (i % 3) * 20, height: 12, borderRadius: 4 }} />
              <Bone style={messagesStyles.time} />
            </View>
            <Bone style={{ width: 160 + (i % 2) * 40, height: 10, borderRadius: 4 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const messagesStyles = StyleSheet.create({
  container: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  content: { flex: 1, gap: 6 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  time: { width: 24, height: 10, borderRadius: 4 },
});

// Notifications skeleton — matches notification rows with avatar + badge + text
export function NotificationsSkeleton() {
  return (
    <View style={notifStyles.container}>
      {/* Filter chips */}
      <View style={notifStyles.chips}>
        {[40, 64, 72, 48, 56].map((w, i) => (
          <Bone key={i} style={{ width: w, height: 28, borderRadius: radius.full }} />
        ))}
      </View>

      {/* Notification rows */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <View key={i} style={notifStyles.row}>
          <Bone style={notifStyles.avatar} />
          <View style={notifStyles.content}>
            <Bone style={{ width: 180 + (i % 3) * 30, height: 12, borderRadius: 4 }} />
            <Bone style={{ width: 120 + (i % 2) * 40, height: 10, borderRadius: 4 }} />
            <Bone style={notifStyles.time} />
          </View>
          {i % 3 === 0 && <Bone style={notifStyles.thumb} />}
        </View>
      ))}
    </View>
  );
}

const notifStyles = StyleSheet.create({
  container: {},
  chips: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  content: { flex: 1, gap: 4 },
  time: { width: 28, height: 8, borderRadius: 4, marginTop: 2 },
  thumb: { width: 40, height: 40, borderRadius: radius.sm },
});

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

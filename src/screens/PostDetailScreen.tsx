import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { setInteraction } from "../lib/interactionCache";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { timeAgo, fullDate } from "../lib/formatters";
import { parseImageUrls } from "../lib/parseImageUrls";
import { ImageCarousel, Lightbox, DetailVideoPlayer } from "../components/MediaViewer";
import { isVideo } from "../lib/parseImageUrls";
import { HammerIcon, TailIcon, CommentIcon } from "../components/Icons";
import MentionText from "../components/MentionText";
import MentionAutocomplete, { extractMentionQuery } from "../components/MentionAutocomplete";
import type { Comment } from "../lib/types";
import { PostDetailSkeleton } from "../components/Skeleton";

type Route = RouteProp<RootStackParamList, "PostDetail">;
type Nav = NativeStackNavigationProp<RootStackParamList>;

interface QuotePost {
  id: string;
  content: string | null;
  image_url: string | null;
  created_at: string;
  profiles: { username: string | null; name: string | null; avatar_url: string | null } | null;
}

interface PostData {
  id: string;
  user_id: string;
  content: string | null;
  image_url: string | null;
  created_at: string;
  game_id: string | null;
  quote_post_id: string | null;
  profiles: { username: string; name: string | null; avatar_url: string | null } | null;
  games: { league: string; home_team: string; away_team: string } | null;
  quote_post: QuotePost | null;
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const QUOTE_MAX_HEIGHT = 500;
const QUOTE_IMAGE_WIDTH = SCREEN_WIDTH - 2 * spacing.md - 2;

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

// Static post content — memoized so interaction state changes don't remount images/text
const PostDetailBody = React.memo(function PostDetailBody({
  post,
  navigation,
  setLightboxIndex,
}: {
  post: PostData;
  navigation: Nav;
  setLightboxIndex: (i: number) => void;
}) {
  const avatarSource = React.useMemo(() => post.profiles?.avatar_url ? { uri: post.profiles.avatar_url } : null, [post.profiles?.avatar_url]);
  const allUrls = React.useMemo(() => parseImageUrls(post.image_url), [post.image_url]);
  const videos = React.useMemo(() => allUrls.filter(isVideo), [allUrls]);
  const images = React.useMemo(() => allUrls.filter((u) => !isVideo(u)), [allUrls]);

  return (
    <View>
      <View style={styles.authorRow}>
        <Pressable onPress={() => post.profiles?.username && navigation.navigate("UserProfile", { username: post.profiles.username })}>
          {avatarSource ? (
            <Image source={avatarSource} style={styles.authorAvatar} contentFit="cover" transition={0} />
          ) : (
            <View style={styles.authorAvatarPlaceholder}>
              <Text style={styles.authorAvatarLetter}>{post.profiles?.username?.[0]?.toUpperCase() || "?"}</Text>
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.authorName}>{post.profiles?.name || post.profiles?.username || "anonymous"}</Text>
          <Text style={styles.authorUsername}>@{post.profiles?.username || "user"}</Text>
        </View>
      </View>

      {post.content ? <MentionText text={post.content} style={styles.postContent} /> : null}

      {allUrls.length > 0 && (
        <View style={styles.mediaSection}>
          {videos.map((v, i) => <DetailVideoPlayer key={`v-${i}`} url={v} />)}
          {images.length > 0 && <ImageCarousel urls={images} onOpenLightbox={setLightboxIndex} />}
        </View>
      )}

      {post.quote_post && (
        <Pressable style={styles.quoteCard} onPress={() => navigation.push("PostDetail", { postId: post.quote_post!.id })}>
          <View style={styles.quoteHeader}>
            {post.quote_post.profiles?.avatar_url ? (
              <Image source={{ uri: post.quote_post.profiles.avatar_url }} style={styles.quoteAvatar} contentFit="cover" transition={0} />
            ) : (
              <View style={styles.quoteAvatarPlaceholder}>
                <Text style={styles.quoteAvatarLetter}>{post.quote_post.profiles?.username?.[0]?.toUpperCase() || "?"}</Text>
              </View>
            )}
            <Text style={styles.quoteName} numberOfLines={1}>{post.quote_post.profiles?.name || post.quote_post.profiles?.username || "user"}</Text>
            <Text style={styles.quoteTime}>{timeAgo(post.quote_post.created_at)}</Text>
          </View>
          {post.quote_post.content && <MentionText text={post.quote_post.content} style={styles.quoteContent} numberOfLines={4} />}
          {post.quote_post.image_url && parseImageUrls(post.quote_post.image_url).length > 0 && (
            <QuoteImage uri={parseImageUrls(post.quote_post.image_url)[0]} />
          )}
        </Pressable>
      )}

      <Text style={styles.timestamp}>{fullDate(post.created_at)}</Text>
    </View>
  );
}, (prev, next) => prev.post.id === next.post.id);

// Action bar — only this re-renders on like/tail
const PostDetailActions = React.memo(function PostDetailActions({
  liked, likeCount, tailed, tailCount, commentCount, onLike, onTail,
}: {
  liked: boolean; likeCount: number; tailed: boolean; tailCount: number; commentCount: number;
  onLike: () => void; onTail: () => void;
}) {
  return (
    <View>
      <View style={styles.statsBar}>
        <Text style={styles.stat}><Text style={styles.statBold}>{likeCount}</Text> {likeCount === 1 ? "hammer" : "hammers"}</Text>
        <Text style={styles.stat}><Text style={styles.statBold}>{tailCount}</Text> {tailCount === 1 ? "tail" : "tails"}</Text>
        <Text style={styles.stat}><Text style={styles.statBold}>{commentCount}</Text> comments</Text>
      </View>
      <View style={styles.actionBar}>
        <Pressable onPress={onLike} style={styles.actionItem} hitSlop={12}>
          <HammerIcon size={22} color={liked ? colors.emerald : colors.textMuted} filled={liked} />
          <Text style={[styles.actionLabel, liked && { color: colors.emerald }]}>Hammer</Text>
        </Pressable>
        <Pressable onPress={onTail} style={styles.actionItem} hitSlop={12}>
          <TailIcon size={22} color={tailed ? colors.emerald : colors.textMuted} />
          <Text style={[styles.actionLabel, tailed && { color: colors.emerald }]}>Tail</Text>
        </Pressable>
        <View style={styles.actionItem}>
          <CommentIcon size={22} color={colors.textMuted} />
          <Text style={styles.actionLabel}>Comment</Text>
        </View>
      </View>
    </View>
  );
});

// Wrapper that composes body + actions — keeps FlatList header stable
function PostDetailHeader({ post, navigation, setLightboxIndex, liked, likeCount, tailed, tailCount, commentCount, onLike, onTail }: {
  post: PostData; navigation: Nav; setLightboxIndex: (i: number) => void;
  liked: boolean; likeCount: number; tailed: boolean; tailCount: number; commentCount: number;
  onLike: () => void; onTail: () => void;
}) {
  return (
    <View>
      <PostDetailBody post={post} navigation={navigation} setLightboxIndex={setLightboxIndex} />
      <PostDetailActions liked={liked} likeCount={likeCount} tailed={tailed} tailCount={tailCount} commentCount={commentCount} onLike={onLike} onTail={onTail} />
      {commentCount > 0 && (
        <View style={styles.commentsHeader}>
          <Text style={styles.commentsHeaderText}>Comments</Text>
        </View>
      )}
    </View>
  );
}

export default function PostDetailScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const inputRef = useRef<TextInput>(null);

  const [post, setPost] = useState<PostData | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [tailed, setTailed] = useState(false);
  const [tailCount, setTailCount] = useState(0);

  const [commentText, setCommentText] = useState("");
  const [commentCursor, setCommentCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string } | null>(null);

  const [lightboxIndex, setLightboxIndex] = useState(-1);

  // Fetch everything
  useEffect(() => {
    async function load() {
      const postId = params.postId;

      // Post + profile + game + quote post
      const { data: postData } = await supabase
        .from("posts")
        .select("id, user_id, content, image_url, created_at, game_id, quote_post_id")
        .eq("id", postId)
        .single();

      if (!postData) { setLoading(false); return; }

      const [profileRes, gameRes, quoteRes] = await Promise.all([
        supabase.from("profiles").select("username, name, avatar_url").eq("id", postData.user_id).single(),
        postData.game_id
          ? supabase.from("games").select("league, home_team, away_team").eq("id", postData.game_id).single()
          : Promise.resolve({ data: null }),
        postData.quote_post_id
          ? supabase.from("posts")
              .select("id, user_id, content, image_url, created_at")
              .eq("id", postData.quote_post_id)
              .single()
              .then(async (res) => {
                if (!res.data) return { data: null };
                const { data: qProfile } = await supabase
                  .from("profiles")
                  .select("username, name, avatar_url")
                  .eq("id", res.data.user_id)
                  .single();
                return { data: { ...res.data, profiles: qProfile } as QuotePost };
              })
          : Promise.resolve({ data: null }),
      ]);

      setPost({
        ...postData,
        profiles: profileRes.data,
        games: gameRes.data,
        quote_post: quoteRes.data,
      });

      // Counts + user status
      const [likesRes, tailsRes, commentsRes] = await Promise.all([
        supabase.from("likes").select("*", { count: "exact", head: true }).eq("post_id", postId),
        supabase.from("tails").select("*", { count: "exact", head: true }).eq("post_id", postId),
        supabase.from("comments")
          .select("id, content, gif_url, created_at, user_id, parent_id, profiles:profiles(username, name, avatar_url, last_active_at)")
          .eq("post_id", postId)
          .order("created_at", { ascending: true }),
      ]);

      setLikeCount(likesRes.count ?? 0);
      setTailCount(tailsRes.count ?? 0);

      // Thread comments
      const flat = (commentsRes.data as unknown as Comment[]) || [];
      const top: Comment[] = [];
      const byParent: Record<string, Comment[]> = {};
      for (const c of flat) {
        if (c.parent_id) {
          (byParent[c.parent_id] ??= []).push(c);
        } else {
          top.push(c);
        }
      }
      for (const c of top) c.replies = byParent[c.id] || [];
      setComments(top);

      // Check user like/tail
      if (user) {
        const [likeCheck, tailCheck] = await Promise.all([
          supabase.from("likes").select("id").eq("post_id", postId).eq("user_id", user.id).maybeSingle(),
          supabase.from("tails").select("id").eq("post_id", postId).eq("user_id", user.id).maybeSingle(),
        ]);
        setLiked(!!likeCheck.data);
        setTailed(!!tailCheck.data);
      }

      setLoading(false);
    }
    load();
  }, [params.postId]);

  const handleLike = useCallback(async () => {
    if (!user || !post) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (liked) {
      const newCount = Math.max(0, likeCount - 1);
      setLiked(false); setLikeCount(newCount);
      setInteraction(post.id, { liked: false, likeCount: newCount, tailed, tailCount });
      await supabase.from("likes").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      const newCount = likeCount + 1;
      setLiked(true); setLikeCount(newCount);
      setInteraction(post.id, { liked: true, likeCount: newCount, tailed, tailCount });
      await supabase.from("likes").insert({ post_id: post.id, user_id: user.id });
    }
  }, [liked, likeCount, tailed, tailCount, user, post]);

  const handleTail = useCallback(async () => {
    if (!user || !post) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (tailed) {
      const newCount = Math.max(0, tailCount - 1);
      setTailed(false); setTailCount(newCount);
      setInteraction(post.id, { liked, likeCount, tailed: false, tailCount: newCount });
      await supabase.from("tails").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      const newCount = tailCount + 1;
      setTailed(true); setTailCount(newCount);
      setInteraction(post.id, { liked, likeCount, tailed: true, tailCount: newCount });
      await supabase.from("tails").insert({ post_id: post.id, user_id: user.id });
    }
  }, [tailed, liked, likeCount, tailCount, user, post]);

  const handleComment = useCallback(async () => {
    if (!user || !commentText.trim() || submitting) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const insertData: Record<string, unknown> = {
      post_id: params.postId,
      user_id: user.id,
      content: commentText.trim(),
    };
    if (replyingTo) insertData.parent_id = replyingTo.id;

    const { data: newComment } = await supabase
      .from("comments")
      .insert(insertData)
      .select("id, content, gif_url, created_at, user_id, parent_id")
      .single();

    if (newComment) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, name, avatar_url, last_active_at")
        .eq("id", user.id)
        .single();

      const comment: Comment = { ...newComment, post_id: params.postId, profiles: profile, replies: [] };

      if (replyingTo) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === replyingTo.id
              ? { ...c, replies: [...(c.replies || []), comment] }
              : c
          )
        );
      } else {
        setComments((prev) => [...prev, comment]);
      }
    }

    setCommentText("");
    setReplyingTo(null);
    setSubmitting(false);
  }, [commentText, user, replyingTo, submitting]);

  const handleCommentMentionSelect = useCallback((username: string) => {
    const textUpToCursor = commentText.slice(0, commentCursor);
    const replaced = textUpToCursor.replace(/@[a-zA-Z0-9_-]*$/, `@${username} `);
    const newText = replaced + commentText.slice(commentCursor);
    setCommentText(newText);
    const newCursor = replaced.length;
    setCommentCursor(newCursor);
    setTimeout(() => {
      inputRef.current?.setNativeProps({ selection: { start: newCursor, end: newCursor } });
    }, 50);
  }, [commentText, commentCursor]);

  const imageUrls = parseImageUrls(post?.image_url).filter(
    (u) => !/\.(mp4|mov|webm|m4v)/i.test(u) && !u.includes("video")
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <PostDetailSkeleton />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Post not found</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={comments}
        renderItem={({ item: comment }) => (
          <View>
            <CommentRow
              comment={comment}
              onReply={(username) => {
                setReplyingTo({ id: comment.id, username });
                inputRef.current?.focus();
              }}
              onUserPress={(username) => navigation.navigate("UserProfile", { username })}
            />
            {comment.replies && comment.replies.length > 0 && (
              <View style={styles.repliesContainer}>
                {comment.replies.map((reply) => (
                  <CommentRow
                    key={reply.id}
                    comment={reply}
                    isReply
                    onReply={(username) => {
                      setReplyingTo({ id: comment.id, username });
                      inputRef.current?.focus();
                    }}
                    onUserPress={(username) => navigation.navigate("UserProfile", { username })}
                  />
                ))}
              </View>
            )}
          </View>
        )}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <PostDetailHeader
            post={post}
            navigation={navigation}
            setLightboxIndex={setLightboxIndex}
            liked={liked}
            likeCount={likeCount}
            tailed={tailed}
            tailCount={tailCount}
            commentCount={comments.length}
            onLike={handleLike}
            onTail={handleTail}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyComments}>
            <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Mention autocomplete — above input bar */}
      <MentionAutocomplete
        text={commentText}
        cursorPosition={commentCursor}
        onSelect={handleCommentMentionSelect}
      />

      {/* Comment input — pinned to bottom */}
      <View style={styles.inputBar}>
        {replyingTo && (
          <View style={styles.replyIndicator}>
            <Text style={styles.replyText}>Replying to <Text style={styles.replyUsername}>@{replyingTo.username}</Text></Text>
            <Pressable onPress={() => setReplyingTo(null)}>
              <Text style={styles.replyCancel}>Cancel</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={commentText}
            onChangeText={setCommentText}
            onSelectionChange={(e) => setCommentCursor(e.nativeEvent.selection.end)}
            placeholder={replyingTo ? `Reply to @${replyingTo.username}...` : "Add a comment..."}
            placeholderTextColor={colors.textMuted}
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={handleComment}
          />
          <Pressable
            onPress={handleComment}
            disabled={!commentText.trim() || submitting}
            style={[styles.sendBtn, (!commentText.trim() || submitting) && styles.sendBtnDisabled]}
          >
            <Text style={styles.sendBtnText}>{submitting ? "..." : "Post"}</Text>
          </Pressable>
        </View>
      </View>

      <Lightbox
        urls={imageUrls}
        startIndex={Math.max(0, lightboxIndex)}
        visible={lightboxIndex >= 0}
        onClose={() => setLightboxIndex(-1)}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Comment Row ───

function CommentRow({
  comment,
  isReply,
  onReply,
  onUserPress,
}: {
  comment: Comment;
  isReply?: boolean;
  onReply: (username: string) => void;
  onUserPress: (username: string) => void;
}) {
  return (
    <View style={[styles.commentRow, isReply && styles.commentReply]}>
      <Pressable onPress={() => comment.profiles?.username && onUserPress(comment.profiles.username)}>
        {comment.profiles?.avatar_url ? (
          <Image source={{ uri: comment.profiles.avatar_url }} style={styles.commentAvatar} contentFit="cover" />
        ) : (
          <View style={styles.commentAvatarPlaceholder}>
            <Text style={styles.commentAvatarLetter}>{comment.profiles?.username?.[0]?.toUpperCase() || "?"}</Text>
          </View>
        )}
      </Pressable>
      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <Pressable onPress={() => comment.profiles?.username && onUserPress(comment.profiles.username)}>
            <Text style={styles.commentName}>{comment.profiles?.name || comment.profiles?.username || "anonymous"}</Text>
          </Pressable>
          <Text style={styles.commentTime}>{timeAgo(comment.created_at)}</Text>
        </View>
        {comment.content && comment.content !== "[GIF]" && (
          <MentionText text={comment.content} style={styles.commentContent} />
        )}
        {comment.gif_url && (
          <Image source={{ uri: comment.gif_url }} style={styles.commentGif} contentFit="cover" />
        )}
        <Pressable onPress={() => onReply(comment.profiles?.username || "anonymous")} hitSlop={8}>
          <Text style={styles.replyBtn}>Reply{comment.replies && comment.replies.length > 0 ? ` (${comment.replies.length})` : ""}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" },
  errorText: { color: colors.textMuted, fontSize: fontSize.md },
  listContent: { paddingBottom: 100 },

  // Author
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  authorAvatar: { width: 44, height: 44, borderRadius: 22 },
  authorAvatarPlaceholder: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  authorAvatarLetter: { color: colors.emerald, fontSize: 18, fontWeight: "700" },
  authorName: { fontSize: fontSize.lg, fontWeight: "600", color: colors.text },
  authorUsername: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 1 },

  // Post content
  postContent: {
    fontSize: fontSize.lg,
    color: colors.text,
    lineHeight: 26,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },

  mediaSection: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },

  // Quote post (Tail Spin embed)
  quoteCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(63,63,70,0.6)",
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  quoteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  quoteAvatar: { width: 16, height: 16, borderRadius: 8 },
  quoteAvatarPlaceholder: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  quoteAvatarLetter: { color: colors.emerald, fontSize: 7, fontWeight: "700" },
  quoteName: { fontSize: fontSize.xs, fontWeight: "600", color: colors.textSecondary, flex: 1 },
  quoteTime: { fontSize: 10, color: colors.textDim },
  quoteContent: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 16,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  quoteImage: {
    width: "100%",
    height: 120,
  },

  // Timestamp
  timestamp: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },

  // Stats
  statsBar: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stat: { fontSize: fontSize.sm, color: colors.textMuted },
  statBold: { fontWeight: "700", color: colors.text },

  // Actions
  actionBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionLabel: { fontSize: fontSize.sm, color: colors.textMuted },

  // Comments header
  commentsHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  commentsHeaderText: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textSecondary },

  // Comment row
  commentRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  commentReply: { paddingLeft: spacing.lg + 36 },
  commentAvatar: { width: 32, height: 32, borderRadius: 16 },
  commentAvatarPlaceholder: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  commentAvatarLetter: { color: colors.emerald, fontSize: 13, fontWeight: "600" },
  commentBody: { flex: 1 },
  commentMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 4 },
  commentName: { fontSize: fontSize.sm, fontWeight: "600", color: colors.text },
  commentTime: { fontSize: fontSize.xs, color: colors.textMuted },
  commentContent: { fontSize: fontSize.md, color: colors.text, lineHeight: 22 },
  commentGif: { width: 180, height: 120, borderRadius: radius.md, marginTop: 6 },
  replyBtn: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: "600", marginTop: 6 },

  repliesContainer: {},

  emptyComments: { paddingVertical: 40, alignItems: "center" },
  emptyText: { color: colors.textMuted, fontSize: fontSize.md },

  // Input bar
  inputBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.lg,
  },
  replyIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  replyText: { fontSize: fontSize.sm, color: colors.textMuted },
  replyUsername: { color: colors.emerald, fontWeight: "600" },
  replyCancel: { fontSize: fontSize.xs, color: colors.textMuted },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    fontSize: fontSize.md,
    color: colors.text,
  },
  sendBtn: {
    backgroundColor: colors.emerald,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.full,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: colors.black, fontSize: fontSize.sm, fontWeight: "700" },
});

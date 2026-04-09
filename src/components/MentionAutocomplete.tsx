import React, { useState, useEffect, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { supabase } from "../lib/supabase";
import { colors, fontSize, spacing, radius } from "../lib/theme";

type ProfileResult = {
  username: string;
  name: string | null;
  avatar_url: string | null;
};

interface MentionAutocompleteProps {
  text: string;
  cursorPosition: number;
  onSelect: (username: string) => void;
}

/**
 * Extracts the @query being typed at the cursor position.
 * Returns null if user is not in the middle of typing a mention.
 */
function extractMentionQuery(text: string, cursor: number): string | null {
  const textUpToCursor = text.slice(0, cursor);
  const match = textUpToCursor.match(/@([a-zA-Z0-9_-]*)$/);
  return match ? match[1] : null;
}

export default function MentionAutocomplete({ text, cursorPosition, onSelect }: MentionAutocompleteProps) {
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = extractMentionQuery(text, cursorPosition);

  useEffect(() => {
    if (query === null || query.length === 0) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase
        .from("profiles")
        .select("username, name, avatar_url")
        .ilike("username", `${query}%`)
        .limit(5);

      setResults((data as ProfileResult[]) || []);
      setLoading(false);
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  if (query === null || query.length === 0) return null;
  if (!loading && results.length === 0) return null;

  return (
    <View style={s.wrapper}>
      <View style={s.container}>
        {loading ? (
          <View style={s.loadingRow}>
            <ActivityIndicator size="small" color={colors.emerald} />
            <Text style={s.loadingText}>Searching...</Text>
          </View>
        ) : (
          results.map((profile) => (
            <Pressable
              key={profile.username}
              style={({ pressed }) => [s.row, pressed && s.rowPressed]}
              onPress={() => onSelect(profile.username)}
            >
              {profile.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={s.avatar} contentFit="cover" transition={0} />
              ) : (
                <View style={s.avatarFallback}>
                  <Text style={s.avatarLetter}>{profile.username[0]?.toUpperCase() ?? "?"}</Text>
                </View>
              )}
              <View style={s.info}>
                <Text style={s.name} numberOfLines={1}>{profile.name || profile.username}</Text>
                {profile.name && <Text style={s.username}>@{profile.username}</Text>}
              </View>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

export { extractMentionQuery };

const s = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "100%",
    zIndex: 50,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  container: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    overflow: "hidden",
    // Shadow for elevation
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    fontSize: fontSize.xs,
    color: colors.textDim,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowPressed: {
    backgroundColor: colors.cardHover,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.cardHover,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.emerald,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: "500",
  },
  username: {
    fontSize: fontSize.xs,
    color: colors.textDim,
  },
});

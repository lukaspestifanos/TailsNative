import React from "react";
import { Text, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors } from "../lib/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const MENTION_REGEX = /@([a-zA-Z0-9_-]+)/g;

interface MentionTextProps {
  text: string;
  style?: any;
  numberOfLines?: number;
}

export default function MentionText({ text, style, numberOfLines }: MentionTextProps) {
  const navigation = useNavigation<Nav>();

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const username = match[1];
    parts.push(
      <Text
        key={`m-${match.index}`}
        style={s.mention}
        onPress={() => navigation.push("UserProfile", { username })}
      >
        @{username}
      </Text>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts}
    </Text>
  );
}

const s = StyleSheet.create({
  mention: {
    color: colors.emerald,
    fontWeight: "600",
  },
});

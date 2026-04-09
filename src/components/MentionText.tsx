import React from "react";
import { Text, Linking, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors } from "../lib/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TLDS =
  "com|org|net|io|co|gg|tv|me|app|dev|xyz|info|biz|us|uk|ca|de|fr|es|it|nl|au|in|jp|br|ru|se|no|fi|be|at|ch|ly|to|fm|ai|so|cc|sh|ws|edu|gov|social";

// Matches @mentions, full URLs (https://...), and bare domains (instagram.com/...)
const TOKEN_REGEX = new RegExp(
  `(@[a-zA-Z0-9_-]+)|(https?:\\/\\/[^\\s<>"'\\)\\]]+)|((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\\.)+(?:${TLDS})(?:\\/[^\\s<>"'\\)\\]]*)?)`,
  "gi"
);

function normalizeUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function stripTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?)]+$/, "");
}

type Part = { type: "text" | "mention" | "url"; value: string };

function tokenize(text: string): Part[] {
  const parts: Part[] = [];
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  TOKEN_REGEX.lastIndex = 0;

  while ((match = TOKEN_REGEX.exec(text)) !== null) {
    const start = match.index;

    // Bare domain match — must be preceded by start-of-string or whitespace
    if (match[3] && start > 0 && !/\s/.test(text[start - 1])) {
      continue;
    }

    if (start > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, start) });
    }

    if (match[1]) {
      parts.push({ type: "mention", value: match[1] });
      lastIndex = start + match[1].length;
    } else {
      const raw = match[2] || match[3];
      const cleaned = stripTrailingPunct(raw);
      parts.push({ type: "url", value: cleaned });
      lastIndex = start + cleaned.length;
      TOKEN_REGEX.lastIndex = lastIndex;
    }
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  return parts;
}

interface MentionTextProps {
  text: string;
  style?: any;
  numberOfLines?: number;
}

export default function MentionText({ text, style, numberOfLines }: MentionTextProps) {
  const navigation = useNavigation<Nav>();
  const parts = tokenize(text);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) => {
        if (part.type === "mention") {
          const username = part.value.slice(1);
          return (
            <Text
              key={`m-${i}`}
              style={s.mention}
              onPress={() => navigation.push("UserProfile", { username })}
            >
              {part.value}
            </Text>
          );
        }
        if (part.type === "url") {
          const href = normalizeUrl(part.value);
          const display = part.value
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "");
          return (
            <Text
              key={`u-${i}`}
              style={s.url}
              onPress={() => Linking.openURL(href)}
            >
              {display}
            </Text>
          );
        }
        return <Text key={`t-${i}`}>{part.value}</Text>;
      })}
    </Text>
  );
}

const s = StyleSheet.create({
  mention: {
    color: colors.emerald,
    fontWeight: "600",
  },
  url: {
    color: colors.emerald,
    textDecorationLine: "underline",
  },
});

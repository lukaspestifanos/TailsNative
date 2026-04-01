import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";

type Route = RouteProp<RootStackParamList, "Player">;

const SPORT_PATHS: Record<string, string> = {
  NBA: "basketball/nba",
  NCAAM: "basketball/mens-college-basketball",
  MLB: "baseball/mlb",
};

type GameEntry = {
  opponent: string;
  result: string;
  score: string;
  date: string;
  stats: string[];
};

const HIGHLIGHT_NBA = ["PTS", "REB", "AST", "STL", "BLK", "FG%"];
const HIGHLIGHT_MLB = ["AB", "H", "R", "RBI", "HR", "AVG"];

export default function PlayerScreen() {
  const { params } = useRoute<Route>();
  const { athleteId, name, headshot, league, stats: currentStats, statLabels } = params;

  const [loading, setLoading] = useState(true);
  const [bio, setBio] = useState({ position: "", jersey: "", team: "", teamLogo: "", age: "", height: "", weight: "" });
  const [seasonStats, setSeasonStats] = useState<{ labels: string[]; values: string[] } | null>(null);
  const [recentGames, setRecentGames] = useState<GameEntry[]>([]);
  const [gameLabels, setGameLabels] = useState<string[]>([]);
  const [rotowire, setRotowire] = useState("");

  const highlights = league === "MLB" ? HIGHLIGHT_MLB : HIGHLIGHT_NBA;

  useEffect(() => {
    const sportPath = SPORT_PATHS[league];
    if (!sportPath) { setLoading(false); return; }

    (async () => {
      try {
        const [ovRes, glRes] = await Promise.all([
          fetch(`https://site.api.espn.com/apis/common/v3/sports/${sportPath}/athletes/${athleteId}/overview`),
          fetch(`https://site.api.espn.com/apis/common/v3/sports/${sportPath}/athletes/${athleteId}/gamelog`),
        ]);

        if (ovRes.ok) {
          const ov = await ovRes.json();
          const stats = ov.statistics;
          if (stats?.labels && stats?.splits?.length > 0) {
            setSeasonStats({ labels: stats.labels, values: stats.splits[0].stats });
          }
          const ath = ov.athlete || {};
          setBio({
            position: ath.position?.abbreviation || "",
            jersey: ath.jersey || "",
            team: ath.team?.displayName || "",
            teamLogo: ath.team?.logo || "",
            age: ath.age ? String(ath.age) : "",
            height: ath.displayHeight || "",
            weight: ath.displayWeight || "",
          });
          if (ov.rotowire?.headline) setRotowire(ov.rotowire.headline);
        }

        if (glRes.ok) {
          const gl = await glRes.json();
          setGameLabels(gl.labels || []);

          const seasonTypes = gl.seasonTypes || [];
          const regular = seasonTypes.find((s: any) => s.displayName?.includes("Regular")) || seasonTypes[0];
          if (regular) {
            const cats = regular.categories || [];
            const mainCat = cats[0];
            const statEvents = mainCat?.events || [];
            const eventMap = gl.events || {};

            const games: GameEntry[] = [];
            for (const se of statEvents.slice(0, 10)) {
              const ev = eventMap[se.eventId];
              if (!ev) continue;
              games.push({
                opponent: ev.opponent?.displayName || "?",
                result: ev.gameResult || "",
                score: ev.score || "",
                date: ev.gameDate || "",
                stats: se.stats || [],
              });
            }
            setRecentGames(games);
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, [athleteId, league]);

  const reorder = (labels: string[], values: string[]) => {
    const pairs = labels.map((l, i) => ({ label: l, value: values[i] || "-" }));
    const first = highlights.map((h) => pairs.find((p) => p.label === h)).filter(Boolean) as { label: string; value: string }[];
    const rest = pairs.filter((p) => !highlights.includes(p.label));
    return [...first, ...rest];
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header — headshot, name, bio */}
      <View style={styles.header}>
        <Image source={{ uri: headshot }} style={styles.headshot} contentFit="cover" />
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.meta}>
            {bio.position ? `${bio.position} ` : ""}
            {bio.jersey ? `#${bio.jersey} ` : ""}
            {bio.team ? `· ${bio.team}` : ""}
          </Text>
          {(bio.height || bio.weight || bio.age) && (
            <Text style={styles.metaSub}>
              {[bio.height, bio.weight, bio.age && `${bio.age} yrs`].filter(Boolean).join(" · ")}
            </Text>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.emerald} style={{ marginTop: 40 }} />
      ) : (
        <>
          {/* This game stats */}
          {currentStats && currentStats.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>This Game</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.statRow}>
                  {reorder(statLabels || [], currentStats).map(({ label, value }) => {
                    const hl = highlights.includes(label);
                    return (
                      <View key={label} style={[styles.statPill, hl && styles.statPillHighlight]}>
                        <Text style={[styles.statValue, hl && styles.statValueHighlight]}>{value}</Text>
                        <Text style={styles.statLabel}>{label}</Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Season averages */}
          {seasonStats && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Season Averages</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.statRow}>
                  {reorder(seasonStats.labels, seasonStats.values).map(({ label, value }) => {
                    const hl = highlights.includes(label);
                    return (
                      <View key={label} style={[styles.statPill, hl && styles.statPillDim]}>
                        <Text style={[styles.statValue, hl ? styles.statValueBright : styles.statValueDim]}>{value}</Text>
                        <Text style={styles.statLabel}>{label}</Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Recent games */}
          {recentGames.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Last {recentGames.length} Games</Text>
              {recentGames.map((g, i) => {
                const ptsIdx = gameLabels.indexOf("PTS");
                const rebIdx = gameLabels.indexOf("REB");
                const astIdx = gameLabels.indexOf("AST");
                return (
                  <View key={i} style={styles.gameRow}>
                    <Text style={[styles.gameResult, g.result === "W" ? styles.gameWin : styles.gameLoss]}>{g.result}</Text>
                    <Text style={styles.gameOpp} numberOfLines={1}>{g.opponent}</Text>
                    <Text style={styles.gameScore}>{g.score}</Text>
                    {ptsIdx >= 0 && <Text style={styles.gameStat}>{g.stats[ptsIdx]}</Text>}
                    {ptsIdx >= 0 && <Text style={styles.gameStatLabel}>PTS</Text>}
                    {rebIdx >= 0 && <Text style={styles.gameStatDim}>{g.stats[rebIdx]}</Text>}
                    {rebIdx >= 0 && <Text style={styles.gameStatLabel}>R</Text>}
                    {astIdx >= 0 && <Text style={styles.gameStatDim}>{g.stats[astIdx]}</Text>}
                    {astIdx >= 0 && <Text style={styles.gameStatLabel}>A</Text>}
                  </View>
                );
              })}
            </View>
          )}

          {/* Rotowire note */}
          {rotowire ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Latest Note</Text>
              <Text style={styles.note}>{rotowire}</Text>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 100 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headshot: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.cardHover,
  },
  headerInfo: { flex: 1 },
  name: { fontSize: fontSize.xl, fontWeight: "800", color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  metaSub: { fontSize: fontSize.xs, color: colors.textDim, marginTop: 2 },

  // Section
  section: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: "700",
    color: colors.textDim,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },

  // Stat pills
  statRow: { flexDirection: "row", gap: spacing.sm },
  statPill: {
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "rgba(39,39,42,0.4)",
  },
  statPillHighlight: { backgroundColor: "rgba(16,185,129,0.1)" },
  statPillDim: { backgroundColor: "rgba(39,39,42,0.4)" },
  statValue: { fontSize: fontSize.md, fontWeight: "700", color: colors.textSecondary },
  statValueHighlight: { color: colors.emerald },
  statValueBright: { color: colors.text },
  statValueDim: { color: colors.textSecondary },
  statLabel: { fontSize: 9, color: colors.textDim, marginTop: 1 },

  // Recent games
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 5,
  },
  gameResult: { fontWeight: "700", fontSize: fontSize.xs, width: 14 },
  gameWin: { color: colors.emerald },
  gameLoss: { color: colors.red },
  gameOpp: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary },
  gameScore: { fontSize: fontSize.xs, color: colors.textDim, width: 44, textAlign: "right" },
  gameStat: { fontSize: fontSize.xs, fontWeight: "700", color: colors.text, width: 24, textAlign: "right" },
  gameStatDim: { fontSize: fontSize.xs, color: colors.textSecondary, width: 20, textAlign: "right" },
  gameStatLabel: { fontSize: 9, color: colors.textDim },

  // Note
  note: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
});

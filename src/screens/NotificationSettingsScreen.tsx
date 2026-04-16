// src/screens/NotificationSettingsScreen.tsx
import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

const LEAGUES = [
  { id: "NBA", label: "NBA", emoji: "\u{1F3C0}" },
  { id: "MLB", label: "MLB", emoji: "\u{26BE}" },
  { id: "NHL", label: "NHL", emoji: "\u{1F3D2}" },
  { id: "NCAAM", label: "College BBall", emoji: "\u{1F3C8}" },
  { id: "soccer", label: "Soccer", emoji: "\u{26BD}" },
  { id: "mma", label: "MMA", emoji: "\u{1F94A}" },
  { id: "tennis", label: "Tennis", emoji: "\u{1F3BE}" },
  { id: "golf", label: "Golf", emoji: "\u{26F3}" },
];

export default function NotificationSettingsScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile?.favorite_leagues) {
      setSelected(profile.favorite_leagues);
    }
  }, [profile]);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    );
    setSaved(false);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    await supabase.from("profiles").update({ favorite_leagues: selected }).eq("id", user.id);
    await refreshProfile();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const allSelected = selected.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.description}>
          Pick which sports you want notifications for. Leave all unchecked to get everything.
        </Text>

        {/* All sports toggle */}
        <Pressable
          onPress={() => { setSelected([]); setSaved(false); }}
          style={[styles.leagueRow, allSelected && styles.leagueRowActive]}
        >
          <Text style={styles.emoji}>🏟️</Text>
          <Text style={[styles.leagueLabel, allSelected && styles.leagueLabelActive]}>All Sports</Text>
          {allSelected && <Text style={styles.check}>✓</Text>}
        </Pressable>

        {LEAGUES.map((league) => {
          const isSelected = selected.includes(league.id);
          return (
            <Pressable
              key={league.id}
              onPress={() => toggle(league.id)}
              style={[styles.leagueRow, isSelected && styles.leagueRowActive]}
            >
              <Text style={styles.emoji}>{league.emoji}</Text>
              <Text style={[styles.leagueLabel, isSelected && styles.leagueLabelActive]}>{league.label}</Text>
              {isSelected && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}

        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveButton, saving && { opacity: 0.5 }]}
        >
          {saving ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <Text style={styles.saveButtonText}>{saved ? "Saved!" : "Save"}</Text>
          )}
        </Pressable>

        <Text style={styles.hint}>
          You'll still get notifications for predictions, DMs, hammers, and follows regardless of these settings.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  description: { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: spacing.md, lineHeight: 20 },
  leagueRow: {
    flexDirection: "row", alignItems: "center", padding: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.lg, marginBottom: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  leagueRowActive: { borderColor: colors.emerald, backgroundColor: "rgba(16,185,129,0.08)" },
  emoji: { fontSize: 24, marginRight: spacing.sm },
  leagueLabel: { flex: 1, fontSize: fontSize.md, color: colors.text, fontWeight: "500" },
  leagueLabelActive: { color: colors.emerald },
  check: { fontSize: 18, color: colors.emerald, fontWeight: "700" },
  saveButton: {
    marginTop: spacing.lg, backgroundColor: colors.emerald,
    paddingVertical: 14, borderRadius: radius.lg, alignItems: "center",
  },
  saveButtonText: { color: "#000", fontSize: fontSize.md, fontWeight: "700" },
  hint: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.md, textAlign: "center", lineHeight: 18 },
});

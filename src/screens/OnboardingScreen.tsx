import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const LEAGUE_OPTIONS = [
  { id: "NBA", label: "NBA", emoji: "\u{1F3C0}" },
  { id: "MLB", label: "MLB", emoji: "\u{26BE}" },
  { id: "NCAAM", label: "College BBall", emoji: "\u{1F3C8}" },
  { id: "soccer", label: "Soccer", emoji: "\u{26BD}" },
  { id: "mma", label: "MMA", emoji: "\u{1F94A}" },
  { id: "tennis", label: "Tennis", emoji: "\u{1F3BE}" },
  { id: "golf", label: "Golf", emoji: "\u{26F3}" },
];

export default function OnboardingScreen() {
  const navigation = useNavigation<Nav>();
  const { user, refreshProfile } = useAuth();

  const [step, setStep] = useState(0); // 0 = name/username, 1 = leagues
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [loading, setLoading] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<TextInput>(null);

  const sanitizeUsername = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);

  const checkUsername = useCallback((value: string) => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    const clean = sanitizeUsername(value);
    if (clean.length < 2) { setUsernameStatus("idle"); return; }

    setUsernameStatus("checking");
    checkTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .ilike("username", clean)
        .maybeSingle();
      setUsernameStatus(data ? "taken" : "available");
    }, 400);
  }, []);

  const handleUsernameChange = (raw: string) => {
    const clean = sanitizeUsername(raw);
    setUsername(clean);
    setError("");
    checkUsername(clean);
  };

  const handleNext = () => {
    if (username.length < 2) { setError("Username must be at least 2 characters."); return; }
    if (usernameStatus === "taken") { setError("That username is taken."); return; }
    if (usernameStatus === "checking") { setError("Checking username..."); return; }
    setError("");
    setStep(1);
  };

  const toggleLeague = (id: string) => {
    setSelectedLeagues((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    );
  };

  const handleFinish = async () => {
    if (!user) return;
    setLoading(true);
    setError("");

    const { error: upsertErr } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        username,
        name: displayName.trim() || null,
        favorite_leagues: selectedLeagues,
      }, { onConflict: "id" });

    if (upsertErr) {
      if (upsertErr.message.includes("duplicate") || upsertErr.message.includes("unique")) {
        setError("That username is taken. Go back and pick another.");
      } else {
        setError(upsertErr.message);
      }
      setLoading(false);
      return;
    }

    await refreshProfile();
    setLoading(false);

    // Navigate to main — reset so they can't go back to onboarding
    navigation.reset({ index: 0, routes: [{ name: "Main" }] });
  };

  // === STEP 0: Username + Display Name ===
  if (step === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bounces={false}>
            <View style={styles.stepIndicator}>
              <View style={[styles.stepDot, styles.stepDotActive]} />
              <View style={styles.stepDot} />
            </View>

            <Text style={styles.title}>Set up your profile</Text>
            <Text style={styles.subtitle}>Pick a username so people can find you</Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.formGroup}>
              <Text style={styles.label}>Username</Text>
              <View style={styles.usernameRow}>
                <Text style={styles.atSign}>@</Text>
                <TextInput
                  style={styles.usernameInput}
                  value={username}
                  onChangeText={handleUsernameChange}
                  placeholder="yourname"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  maxLength={24}
                  returnKeyType="next"
                  onSubmitEditing={() => nameRef.current?.focus()}
                />
                {usernameStatus === "checking" && <ActivityIndicator color={colors.textMuted} size="small" />}
                {usernameStatus === "available" && <Text style={styles.checkOk}>OK</Text>}
                {usernameStatus === "taken" && <Text style={styles.checkBad}>Taken</Text>}
              </View>
              <Text style={styles.hint}>2-24 characters, letters, numbers, underscores</Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Display Name <Text style={styles.optional}>(optional)</Text></Text>
              <TextInput
                ref={nameRef}
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={colors.textDim}
                maxLength={50}
                returnKeyType="done"
                onSubmitEditing={handleNext}
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.btnPressed,
                (username.length < 2 || usernameStatus === "taken") && styles.btnDisabled,
              ]}
              onPress={handleNext}
              disabled={username.length < 2 || usernameStatus === "taken"}
            >
              <Text style={styles.primaryBtnText}>Next</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // === STEP 1: Favorite Leagues ===
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <View style={styles.stepIndicator}>
          <View style={[styles.stepDot, styles.stepDotDone]} />
          <View style={[styles.stepDot, styles.stepDotActive]} />
        </View>

        <Text style={styles.title}>What do you follow?</Text>
        <Text style={styles.subtitle}>Pick your favorite leagues. These will show first in Games.</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.leagueGrid}>
          {LEAGUE_OPTIONS.map((league) => {
            const selected = selectedLeagues.includes(league.id);
            return (
              <Pressable
                key={league.id}
                style={[styles.leagueChip, selected && styles.leagueChipSelected]}
                onPress={() => toggleLeague(league.id)}
              >
                <Text style={styles.leagueEmoji}>{league.emoji}</Text>
                <Text style={[styles.leagueLabel, selected && styles.leagueLabelSelected]}>
                  {league.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.bottomBtns}>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed, loading && styles.btnDisabled]}
            onPress={handleFinish}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.black} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {selectedLeagues.length > 0 ? "Let's go" : "Skip for now"}
              </Text>
            )}
          </Pressable>

          <Pressable style={styles.backBtn} onPress={() => { setStep(0); setError(""); }}>
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 40,
    justifyContent: "center",
  },

  // Step indicator
  stepIndicator: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 32 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  stepDotActive: { backgroundColor: colors.emerald, width: 24 },
  stepDotDone: { backgroundColor: colors.emeraldDark },

  title: { fontSize: fontSize.xxl, fontWeight: "700", color: colors.text, textAlign: "center", marginBottom: spacing.sm },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: "center", marginBottom: spacing.xxl, lineHeight: 20 },

  errorText: { fontSize: fontSize.xs, color: colors.red, textAlign: "center", marginBottom: spacing.md },

  // Form
  formGroup: { marginBottom: spacing.lg },
  label: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", marginBottom: 6, letterSpacing: 0.5 },
  optional: { color: colors.textDim, fontWeight: "400", textTransform: "none" },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 13 : 10,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  usernameRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  atSign: { fontSize: fontSize.sm, color: colors.textDim, fontWeight: "700", marginRight: 2 },
  usernameInput: {
    flex: 1,
    paddingVertical: Platform.OS === "ios" ? 13 : 10,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  checkOk: { fontSize: 11, fontWeight: "700", color: colors.emerald },
  checkBad: { fontSize: 11, fontWeight: "700", color: colors.red },
  hint: { fontSize: 10, color: colors.textDim, marginTop: 4 },

  // League picker
  leagueGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
    marginBottom: spacing.xxl,
  },
  leagueChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  leagueChipSelected: {
    borderColor: colors.emerald,
    backgroundColor: colors.emeraldBg,
  },
  leagueEmoji: { fontSize: 18 },
  leagueLabel: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textSecondary },
  leagueLabelSelected: { color: colors.emerald },

  // Buttons
  primaryBtn: {
    backgroundColor: colors.emerald,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  primaryBtnText: { color: colors.black, fontSize: fontSize.md, fontWeight: "700" },
  btnPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  btnDisabled: { opacity: 0.5 },
  bottomBtns: { gap: spacing.md },
  backBtn: { alignItems: "center", paddingVertical: spacing.md },
  backBtnText: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "600" },
});

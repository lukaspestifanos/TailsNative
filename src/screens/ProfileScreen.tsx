import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../lib/AuthContext";
import { supabase } from "../lib/supabase";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { ProfileSkeleton } from "../components/Skeleton";
import UserProfileScreen from "./UserProfileScreen";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ProfileScreen() {
  const { profile, session, loading, refreshProfile } = useAuth();
  const navigation = useNavigation<Nav>();

  const [dbUsername, setDbUsername] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (loading) return;

    // Signed out — reset
    if (!session) {
      setDbUsername(null);
      setChecked(true);
      return;
    }

    // Already have username from context
    if (profile?.username) {
      setDbUsername(profile.username);
      setChecked(true);
      return;
    }

    // Check DB directly
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .maybeSingle();

      if (data?.username) {
        setDbUsername(data.username);
        refreshProfile();
      } else {
        setDbUsername(null);
        navigation.navigate("Onboarding");
      }
      setChecked(true);
    })();
  }, [loading, session, profile?.username]);

  const username = profile?.username || dbUsername;
  if (session && checked && username) {
    return <UserProfileScreen overrideUsername={username} />;
  }

  // Not signed in — show sign-in prompt
  if (!session && checked) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Profile</Text>
        </View>
        <View style={s.signInPrompt}>
          <View style={s.signInIconWrap}>
            <Text style={s.signInIcon}>@</Text>
          </View>
          <Text style={s.signInTitle}>Your Profile</Text>
          <Text style={s.signInSubtitle}>
            Sign in to view your profile, posts, picks record, and manage your account.
          </Text>
          <Pressable
            style={({ pressed }) => [s.signInBtn, pressed && s.signInBtnPressed]}
            onPress={() => navigation.navigate("Login")}
          >
            <Text style={s.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Loading state
  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      <ProfileSkeleton />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text },
  signInPrompt: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxl + 8,
  },
  signInIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.emeraldBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  signInIcon: { fontSize: 22, fontWeight: "800", color: colors.emerald },
  signInTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  signInSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  signInBtn: {
    backgroundColor: colors.emerald,
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: radius.lg,
  },
  signInBtnPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  signInBtnText: { color: colors.black, fontSize: fontSize.md, fontWeight: "700" },
});

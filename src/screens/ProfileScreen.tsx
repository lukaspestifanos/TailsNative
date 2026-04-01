import React, { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../lib/AuthContext";
import { colors } from "../lib/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Profile tab — redirects to the user's own UserProfile screen (or onboarding if no profile)
export default function ProfileScreen() {
  const { profile, session } = useAuth();
  const navigation = useNavigation<Nav>();

  useEffect(() => {
    if (!session) {
      navigation.navigate("Login");
    } else if (profile?.username) {
      navigation.navigate("UserProfile", { username: profile.username });
    } else {
      navigation.navigate("Onboarding");
    }
  }, [profile, session]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.emerald} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" },
});

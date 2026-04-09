import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../lib/AuthContext";
import { PlusIcon } from "./Icons";
import { colors } from "../lib/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function FloatingComposeButton() {
  const navigation = useNavigation<Nav>();
  const { session, profile } = useAuth();
  const isGuest = !session || !profile?.username;

  return (
    <Pressable
      style={({ pressed }) => [s.fab, pressed && s.fabPressed]}
      onPress={() => navigation.navigate(isGuest ? "Login" : "Compose")}
    >
      <PlusIcon size={26} color="#fff" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 20,
    right: 16,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },
  fabPressed: {
    backgroundColor: colors.emeraldDark,
    transform: [{ scale: 0.93 }],
  },
});

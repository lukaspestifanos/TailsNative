import { useEffect, useRef, useState, useCallback } from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, NavigationContainerRef } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { AuthProvider } from "./src/lib/AuthContext";
import AppNavigator from "./src/navigation/AppNavigator";
import AnimatedSplash from "./src/components/AnimatedSplash";
import type { RootStackParamList } from "./src/navigation/AppNavigator";
import { colors } from "./src/lib/theme";

// Keep the native splash visible while JS loads
SplashScreen.preventAutoHideAsync().catch(() => {});

function AppInner() {
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const [splashDone, setSplashDone] = useState(false);

  // Hide native splash once our animated one is mounted and showing
  const onNavReady = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Handle notification taps — navigate to relevant screen
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (!data?.type) return;

      switch (data.type) {
        case "game_alert":
          if (data.gameId) navigationRef.current?.navigate("GameDetail", { gameId: data.gameId as string });
          break;
        case "like":
        case "comment":
        case "tail":
          if (data.postId) navigationRef.current?.navigate("PostDetail", { postId: data.postId as string });
          break;
        case "follow":
          if (data.userId) navigationRef.current?.navigate("UserProfile", { username: data.username as string });
          break;
        case "message":
          if (data.conversationId) navigationRef.current?.navigate("Conversation", { conversationId: data.conversationId as string });
          break;
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={onNavReady}
      theme={{
        dark: true,
        colors: {
          primary: colors.emerald,
          background: colors.bg,
          card: colors.bg,
          text: colors.text,
          border: colors.border,
          notification: colors.emerald,
        },
        fonts: {
          regular: { fontFamily: "System", fontWeight: "400" },
          medium: { fontFamily: "System", fontWeight: "500" },
          bold: { fontFamily: "System", fontWeight: "700" },
          heavy: { fontFamily: "System", fontWeight: "800" },
        },
      }}
    >
      <AppNavigator />
      {!splashDone && (
        <AnimatedSplash onFinish={() => setSplashDone(true)} />
      )}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppInner />
        <StatusBar style="light" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

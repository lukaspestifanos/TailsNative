import { useEffect, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, NavigationContainerRef } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { AuthProvider } from "./src/lib/AuthContext";
import AppNavigator from "./src/navigation/AppNavigator";
import type { RootStackParamList } from "./src/navigation/AppNavigator";
import { colors } from "./src/lib/theme";

export default function App() {
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  // Handle notification taps — navigate to relevant screen
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.type === "game_alert" && data?.gameId) {
        navigationRef.current?.navigate("GameDetail", { gameId: data.gameId as string });
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer
          ref={navigationRef}
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
        </NavigationContainer>
        <StatusBar style="light" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

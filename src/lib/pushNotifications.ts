import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// Check if running in Expo Go (push notifications unsupported in SDK 53)
const isExpoGo = Constants.appOwnership === "expo";

// Configure how notifications appear when the app is in the foreground
if (!isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function registerForPushNotifications(userId: string): Promise<string | null> {
  // Push notifications don't work in Expo Go (SDK 53+) or on simulators
  if (isExpoGo) {
    console.log("[Push] Skipping — Expo Go does not support push notifications");
    return null;
  }

  if (!Device.isDevice) {
    console.log("[Push] Skipping — not a physical device");
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.log("[Push] Skipping — no EAS projectId configured");
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request if not already granted
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("[Push] Permission not granted");
    return null;
  }

  // Android needs a notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#10b981",
    });
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;
    console.log("[Push] Token:", token);

    // Store token in Supabase
    await supabase.from("push_tokens").upsert(
      { user_id: userId, expo_token: token, updated_at: new Date().toISOString() },
      { onConflict: "user_id,expo_token" }
    );

    return token;
  } catch (e) {
    console.warn("[Push] Token registration failed:", e);
    return null;
  }
}

export async function unregisterPushToken(userId: string) {
  if (isExpoGo) return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from("push_tokens").delete()
      .eq("user_id", userId)
      .eq("expo_token", tokenData.data);
  } catch {}
}

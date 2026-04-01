import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { View, Text, StyleSheet } from "react-native";
import { colors, fontSize } from "../lib/theme";
import { useAuth } from "../lib/AuthContext";
import { FeedIcon, GamesIcon, MessagesIcon, NotificationsIcon, ProfileIcon } from "../components/Icons";

// Screens
import LoginScreen from "../screens/LoginScreen";
import FeedScreen from "../screens/FeedScreen";
import GamesScreen from "../screens/GamesScreen";
import MessagesScreen from "../screens/MessagesScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import ProfileScreen from "../screens/ProfileScreen";
import PostDetailScreen from "../screens/PostDetailScreen";
import GameDetailScreen from "../screens/GameDetailScreen";
import UserProfileScreen from "../screens/UserProfileScreen";
import ConversationScreen from "../screens/ConversationScreen";
import VideoPostScreen from "../screens/VideoPostScreen";
import PlayerScreen from "../screens/PlayerScreen";
import OnboardingScreen from "../screens/OnboardingScreen";

// Type definitions for navigation
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  PostDetail: { postId: string };
  VideoPost: { postId: string; videoUrl: string };
  GameDetail: { gameId: string; game?: { id: string; league: string; home_team: string; away_team: string; score_home: number | null; score_away: number | null; status: string | null; start_time: string; home_logo?: string; away_logo?: string; period?: number; clock?: string } };
  Player: { athleteId: string; name: string; headshot: string; league: string; stats?: string[]; statLabels?: string[] };
  UserProfile: { username: string };
  Conversation: { conversationId: string };
  Onboarding: undefined;
};

export type TabParamList = {
  Feed: undefined;
  Games: undefined;
  Messages: undefined;
  Notifications: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

// Tab bar icons — exact SVGs from web app's BottomTabBar.tsx
const TAB_ICONS: Record<string, React.FC<{ size?: number; color?: string }>> = {
  Feed: FeedIcon,
  Games: GamesIcon,
  Messages: MessagesIcon,
  Notifications: NotificationsIcon,
  Profile: ProfileIcon,
};

// Main tab navigator — matches web's BottomTabBar
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 84,
          paddingTop: 8,
          paddingBottom: 28,
        },
        tabBarActiveTintColor: colors.emerald,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "600",
          marginTop: 2,
        },
      }}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{
          tabBarLabel: "Feed",
          tabBarIcon: ({ focused }) => <FeedIcon color={focused ? colors.emerald : colors.textMuted} />,
        }}
      />
      <Tab.Screen
        name="Games"
        component={GamesScreen}
        options={{
          tabBarLabel: "Games",
          tabBarIcon: ({ focused }) => <GamesIcon color={focused ? colors.emerald : colors.textMuted} />,
        }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesScreen}
        options={{
          tabBarLabel: "DMs",
          tabBarIcon: ({ focused }) => <MessagesIcon color={focused ? colors.emerald : colors.textMuted} />,
        }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          tabBarLabel: "Alerts",
          tabBarIcon: ({ focused }) => <NotificationsIcon color={focused ? colors.emerald : colors.textMuted} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: "Profile",
          tabBarIcon: ({ focused }) => <ProfileIcon color={focused ? colors.emerald : colors.textMuted} />,
        }}
      />
    </Tab.Navigator>
  );
}

// Root navigator — auth gate + stack for drill-in screens
export default function AppNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={loadingStyles.container}>
        <Text style={loadingStyles.logo}>Tails</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "slide_from_right",
        gestureEnabled: true,
        fullScreenGestureEnabled: false,
      }}
    >
      {false && !session ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen
            name="PostDetail"
            component={PostDetailScreen}
            options={{
              headerShown: true,
              headerTitle: "Post",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              headerBackTitle: "",
            }}
          />
          <Stack.Screen
            name="VideoPost"
            component={VideoPostScreen}
            options={{
              headerShown: false,
              animation: "slide_from_bottom",
              gestureEnabled: true,
              fullScreenGestureEnabled: true,
              contentStyle: { backgroundColor: colors.black },
            }}
          />
          <Stack.Screen
            name="GameDetail"
            component={GameDetailScreen}
            options={{
              headerShown: true,
              headerTitle: "Game",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              headerBackTitle: "",
              fullScreenGestureEnabled: false,
              gestureEnabled: true,
            }}
          />
          <Stack.Screen
            name="Player"
            component={PlayerScreen}
            options={{
              headerShown: true,
              headerTitle: "Player",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              headerBackTitle: "",
            }}
          />
          <Stack.Screen
            name="UserProfile"
            component={UserProfileScreen}
            options={{
              headerShown: true,
              headerTitle: "",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              headerBackTitle: "",
              fullScreenGestureEnabled: false,
            }}
          />
          <Stack.Screen
            name="Conversation"
            component={ConversationScreen}
            options={{
              headerShown: true,
              headerTitle: "",
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              headerBackTitle: "",
            }}
          />
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{
              headerShown: false,
              animation: "slide_from_bottom",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{
              headerShown: false,
              animation: "slide_from_bottom",
              gestureEnabled: false,
            }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
    justifyContent: "center",
    alignItems: "center",
  },
  logo: {
    fontSize: 36,
    fontWeight: "800",
    color: colors.emerald,
  },
});

import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile } from "./types";
import { registerForPushNotifications, unregisterPushToken } from "./pushNotifications";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  blockedIds: Set<string>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshBlocks: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  blockedIds: new Set(),
  signOut: async () => {},
  refreshProfile: async () => {},
  refreshBlocks: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, name, bio, avatar_url, created_at, favorite_leagues")
      .eq("id", userId)
      .maybeSingle();
    setProfile(data);
  };

  const fetchBlocks = async (userId: string) => {
    // Two-way: people I block AND people who blocked me — both should be invisible to each other
    const [blocked, blockedBy] = await Promise.all([
      supabase.from("blocks").select("blocked_id").eq("blocker_id", userId),
      supabase.from("blocks").select("blocker_id").eq("blocked_id", userId),
    ]);
    const ids = new Set<string>();
    (blocked.data || []).forEach((r: any) => ids.add(r.blocked_id));
    (blockedBy.data || []).forEach((r: any) => ids.add(r.blocker_id));
    setBlockedIds(ids);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        // Stale/invalid refresh token — clear everything
        console.warn("[Auth] getSession error, signing out:", error.message);
        supabase.auth.signOut().catch(() => {});
        setSession(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
        fetchBlocks(session.user.id);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && !session) {
        // Refresh failed — force sign out
        console.warn("[Auth] Token refresh failed, signing out");
        supabase.auth.signOut().catch(() => {});
        setSession(null);
        setProfile(null);
        return;
      }
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
        fetchBlocks(session.user.id);
        // Register for push notifications on sign-in
        registerForPushNotifications(session.user.id).catch(() => {});
      } else {
        setProfile(null);
        setBlockedIds(new Set());
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    if (session?.user) {
      await unregisterPushToken(session.user.id).catch(() => {});
    }
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setBlockedIds(new Set());
  };

  const refreshProfile = async () => {
    if (session?.user) {
      await fetchProfile(session.user.id);
    }
  };

  const refreshBlocks = async () => {
    if (session?.user) {
      await fetchBlocks(session.user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        blockedIds,
        signOut,
        refreshProfile,
        refreshBlocks,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

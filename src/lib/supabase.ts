import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

export const SUPABASE_URL = "https://aribokpssbfghhcfhuut.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyaWJva3Bzc2JmZ2hoY2ZodXV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyMTIyMzQsImV4cCI6MjA4NDc4ODIzNH0.ebsYJ-b6YXd_TIOZHeGtIvdD0tdWZdbseH6klotAxl8";

export const API_BASE = "https://www.tails.social";

// Secure token storage for React Native
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "implicit",
  },
});

import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import * as Device from "expo-device";
import * as Application from "expo-application";
import { supabase } from "../lib/supabase";
import { colors, fontSize, spacing, radius } from "../lib/theme";

type Mode = "welcome" | "login" | "register" | "verify";

async function getDeviceInfo() {
  let deviceId: string | null = null;
  try {
    if (Platform.OS === "android") {
      deviceId = Application.getAndroidId();
    } else {
      deviceId = await Application.getIosIdForVendorAsync();
    }
  } catch {}
  return {
    deviceId: deviceId || `unknown_${Date.now()}`,
    deviceModel: Device.modelName || "Unknown",
    osName: Device.osName || Platform.OS,
    osVersion: Device.osVersion || "Unknown",
    isEmulator: !Device.isDevice,
  };
}

async function checkEmailDomain(email: string): Promise<string | null> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "Invalid email address.";
  const { data } = await supabase
    .from("blocked_email_domains")
    .select("domain")
    .eq("domain", domain)
    .maybeSingle();
  if (data) return "Please use a non-disposable email address.";
  return null;
}

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>("welcome");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verifyEmail, setVerifyEmail] = useState("");
  const navigation = useNavigation();
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const dismiss = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  const handleRegister = async () => {
    setError("");
    const trimEmail = email.trim().toLowerCase();
    const trimPassword = password.trim();

    if (!trimEmail || !trimPassword) { setError("Email and password are required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimEmail)) { setError("Enter a valid email address."); return; }
    if (trimPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (trimPassword !== confirmPassword.trim()) { setError("Passwords don't match."); return; }

    setLoading(true);

    // Check disposable email
    const domainErr = await checkEmailDomain(trimEmail);
    if (domainErr) { setError(domainErr); setLoading(false); return; }

    // Get device info
    const device = await getDeviceInfo();

    // Block emulators (skip check in dev/Expo Go — Device.isDevice can be unreliable)
    if (device.isEmulator && !__DEV__) {
      setError("Registration is not available on emulators.");
      setLoading(false);
      return;
    }

    // Check rate limits via RPC (skip in dev)
    if (!__DEV__) {
      try {
        const { data: rateCheck, error: rpcErr } = await supabase.rpc("check_registration_allowed", {
          p_ip: "mobile_client",
          p_device_id: device.deviceId,
          p_email: trimEmail,
        });
        if (rpcErr) console.warn("[Register] Rate limit RPC error:", rpcErr.message);
        if (rateCheck && rateCheck.length > 0 && !rateCheck[0].allowed) {
          setError(rateCheck[0].reason);
          setLoading(false);
          return;
        }
      } catch (e) {
        console.warn("[Register] Rate limit check failed:", e);
      }
    }

    // Register with Supabase
    console.log("[Register] Calling supabase.auth.signUp for", trimEmail);
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: trimEmail,
      password: trimPassword,
      options: {
        data: {
          device_id: device.deviceId,
          device_model: device.deviceModel,
          os_name: device.osName,
        },
      },
    });

    console.log("[Register] signUp result:", signUpErr ? `ERROR: ${signUpErr.message}` : `OK, user=${data.user?.id}, session=${!!data.session}`);

    if (signUpErr) {
      setError(signUpErr.message);
      setLoading(false);
      return;
    }

    // Log the attempt
    try {
      await supabase.rpc("log_registration_attempt", {
        p_ip: "mobile_client",
        p_device_id: device.deviceId,
        p_email: trimEmail,
        p_success: true,
      });
    } catch {}

    // Register device fingerprint if we got a user
    if (data.user) {
      try {
        await supabase.from("device_fingerprints").upsert({
          user_id: data.user.id,
          device_id: device.deviceId,
          device_model: device.deviceModel,
          os_name: device.osName,
          os_version: device.osVersion,
          app_version: Application.nativeApplicationVersion || "1.0.0",
          is_emulator: device.isEmulator,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "user_id,device_id" });
      } catch {}
    }

    // If no session returned, try signing in directly
    if (!data.session && data.user) {
      console.log("[Register] No session returned, attempting signInWithPassword...");
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: trimEmail,
        password: trimPassword,
      });
      console.log("[Register] signIn result:", signInErr ? `ERROR: ${signInErr.message}` : `OK, session=${!!signInData.session}`);
      if (signInErr) {
        setError(signInErr.message);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    dismiss();
  };

  const handleLogin = async () => {
    setError("");
    const trimEmail = email.trim().toLowerCase();
    const trimPassword = password.trim();

    if (!trimEmail || !trimPassword) { setError("Email and password are required."); return; }

    setLoading(true);

    const { data, error: signInErr } = await supabase.auth.signInWithPassword({
      email: trimEmail,
      password: trimPassword,
    });

    if (signInErr) {
      if (signInErr.message.includes("Email not confirmed")) {
        setError("Check your email for a verification link before signing in.");
      } else if (signInErr.message.includes("Invalid login credentials")) {
        setError("Incorrect email or password.");
      } else {
        setError(signInErr.message);
      }
      setLoading(false);
      return;
    }

    // Check if banned
    if (data.user) {
      const { data: ban } = await supabase
        .from("banned_users")
        .select("reason, expires_at")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (ban) {
        const expired = ban.expires_at && new Date(ban.expires_at) < new Date();
        if (!expired) {
          await supabase.auth.signOut();
          setError(`Account suspended: ${ban.reason}`);
          setLoading(false);
          return;
        }
      }

      // Update device fingerprint
      const device = await getDeviceInfo();
      try {
        await supabase.from("device_fingerprints").upsert({
          user_id: data.user.id,
          device_id: device.deviceId,
          device_model: device.deviceModel,
          os_name: device.osName,
          os_version: device.osVersion,
          app_version: Application.nativeApplicationVersion || "1.0.0",
          is_emulator: device.isEmulator,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "user_id,device_id" });
      } catch {}
    }

    setLoading(false);
    dismiss();
  };

  const handleResendVerification = async () => {
    setLoading(true);
    setError("");
    const { error: resendErr } = await supabase.auth.resend({
      type: "signup",
      email: verifyEmail,
    });
    setLoading(false);
    if (resendErr) {
      setError(resendErr.message);
    } else {
      Alert.alert("Email Sent", "Check your inbox for the verification link.");
    }
  };

  // === WELCOME SCREEN ===
  if (mode === "welcome") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {navigation.canGoBack() && (
            <Pressable style={styles.closeBtn} onPress={dismiss}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          )}

          <View style={styles.logoSection}>
            <Text style={styles.logo}>Tails</Text>
            <Text style={styles.tagline}>The Sports Social</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Welcome</Text>
            <Text style={styles.cardSubtitle}>
              Share picks, track bets, follow the action
            </Text>

            <View style={styles.buttonGroup}>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
                onPress={() => setMode("register")}
              >
                <Text style={styles.primaryBtnText}>Create Account</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
                onPress={() => setMode("login")}
              >
                <Text style={styles.secondaryBtnText}>Sign In</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.footer}>
            Share slips. Track picks. Build your record.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // === VERIFY EMAIL SCREEN ===
  if (mode === "verify") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.logoSection}>
            <View style={styles.verifyIconWrap}>
              <Text style={styles.verifyIcon}>@</Text>
            </View>
            <Text style={styles.verifyTitle}>Check Your Email</Text>
            <Text style={styles.verifySubtitle}>
              We sent a verification link to
            </Text>
            <Text style={styles.verifyEmail}>{verifyEmail}</Text>
            <Text style={styles.verifyHint}>
              Click the link in the email to verify your account, then come back and sign in.
            </Text>
          </View>

          <View style={[styles.card, { gap: spacing.md }]}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={() => { setMode("login"); setError(""); setPassword(""); }}
            >
              <Text style={styles.primaryBtnText}>Go to Sign In</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.tertiaryBtn, pressed && styles.btnPressed]}
              onPress={handleResendVerification}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.emerald} size="small" />
              ) : (
                <Text style={styles.tertiaryBtnText}>Resend verification email</Text>
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // === LOGIN / REGISTER FORM ===
  const isRegister = mode === "register";

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={styles.logoSection}>
            <Text style={styles.logo}>Tails</Text>
            <Text style={styles.tagline}>The Sports Social</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {isRegister ? "Create Account" : "Welcome Back"}
            </Text>
            <Text style={styles.cardSubtitle}>
              {isRegister ? "Sign up with your email" : "Sign in to your account"}
            </Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.formGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(t) => { setEmail(t); setError(""); }}
                placeholder="you@example.com"
                placeholderTextColor={colors.textDim}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                ref={passwordRef}
                style={styles.input}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(""); }}
                placeholder={isRegister ? "Min. 8 characters" : "Your password"}
                placeholderTextColor={colors.textDim}
                secureTextEntry
                autoComplete={isRegister ? "new-password" : "current-password"}
                returnKeyType={isRegister ? "next" : "go"}
                onSubmitEditing={() => isRegister ? confirmRef.current?.focus() : handleLogin()}
              />
            </View>

            {isRegister && (
              <View style={styles.formGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <TextInput
                  ref={confirmRef}
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); setError(""); }}
                  placeholder="Repeat password"
                  placeholderTextColor={colors.textDim}
                  secureTextEntry
                  autoComplete="new-password"
                  returnKeyType="go"
                  onSubmitEditing={handleRegister}
                />
              </View>
            )}

            <View style={styles.buttonGroup}>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed, loading && styles.btnDisabled]}
                onPress={isRegister ? handleRegister : handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color={colors.black} />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {isRegister ? "Create Account" : "Sign In"}
                  </Text>
                )}
              </Pressable>
            </View>

            <Pressable
              style={styles.switchMode}
              onPress={() => { setMode(isRegister ? "login" : "register"); setError(""); setPassword(""); setConfirmPassword(""); }}
            >
              <Text style={styles.switchModeText}>
                {isRegister ? "Already have an account? " : "Don't have an account? "}
                <Text style={styles.switchModeLink}>
                  {isRegister ? "Sign In" : "Sign Up"}
                </Text>
              </Text>
            </Pressable>
          </View>

          <Pressable style={styles.backBtn} onPress={() => setMode("welcome")}>
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.black,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
    paddingVertical: 40,
  },
  closeBtn: {
    position: "absolute",
    top: 0,
    right: spacing.xxl,
  },
  closeBtnText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: "600",
  },
  logoSection: {
    alignItems: "center",
    marginBottom: 36,
  },
  logo: {
    fontSize: 48,
    fontWeight: "800",
    color: colors.emerald,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  card: {
    width: "100%",
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
  },
  cardTitle: {
    fontSize: fontSize.xxl,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  cardSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  errorText: {
    fontSize: fontSize.xs,
    color: colors.red,
    textAlign: "center",
    marginBottom: spacing.md,
    lineHeight: 16,
  },
  formGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 13 : 10,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  buttonGroup: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  primaryBtn: {
    backgroundColor: colors.emerald,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: "center",
  },
  primaryBtnText: {
    color: colors.black,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  secondaryBtn: {
    backgroundColor: "transparent",
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  tertiaryBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  tertiaryBtnText: {
    color: colors.emerald,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  btnDisabled: {
    opacity: 0.6,
  },
  switchMode: {
    marginTop: spacing.lg,
    alignItems: "center",
  },
  switchModeText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  switchModeLink: {
    color: colors.emerald,
    fontWeight: "700",
  },
  backBtn: {
    marginTop: spacing.xl,
  },
  backBtnText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: "600",
  },
  footer: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    marginTop: 40,
    textAlign: "center",
  },
  // Verify screen
  verifyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.emeraldBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  verifyIcon: { fontSize: 24, fontWeight: "800", color: colors.emerald },
  verifyTitle: { fontSize: fontSize.xl, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  verifySubtitle: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: "center" },
  verifyEmail: { fontSize: fontSize.sm, fontWeight: "700", color: colors.emerald, marginTop: 4, marginBottom: spacing.md },
  verifyHint: { fontSize: fontSize.xs, color: colors.textDim, textAlign: "center", lineHeight: 18 },
});

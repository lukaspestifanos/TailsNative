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
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import Svg, { Path } from "react-native-svg";
import { supabase, SUPABASE_URL } from "../lib/supabase";
import { colors, fontSize, spacing, radius } from "../lib/theme";

type Mode = "welcome" | "login" | "register";

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
  const navigation = useNavigation();
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError("");

    try {
      // Get the OAuth URL from Supabase — it handles the Google provider config
      // Use the Supabase callback URL directly — after Google auth, Supabase will
      // redirect to our deep link with the tokens in the URL fragment
      const redirectTo = "tails://auth/callback";

      const { data, error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (oauthErr || !data.url) {
        setError(oauthErr?.message || "Failed to start Google sign-in.");
        setGoogleLoading(false);
        return;
      }

      console.log("[Google] Opening auth URL, expecting redirect to:", redirectTo);

      // Open the Supabase OAuth URL — listen for BOTH the custom scheme and the Supabase callback
      // The browser will close when it detects a URL starting with our scheme
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectTo,
      );

      console.log("[Google] Browser result:", result.type, result.type === "success" ? (result as any).url?.slice(0, 80) : "");

      if (result.type === "success" && (result as any).url) {
        const url = (result as any).url as string;
        // Tokens can be in fragment (#) or query (?)
        const fragment = url.includes("#") ? url.split("#")[1] : "";
        const query = url.includes("?") ? url.split("?")[1] : "";
        const params = new URLSearchParams(fragment || query);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (accessToken && refreshToken) {
          const { data: sessionData, error: sessionErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionErr) {
            setError(sessionErr.message);
            setGoogleLoading(false);
            return;
          }

          // Register device fingerprint
          if (sessionData.user) {
            const device = await getDeviceInfo();
            try {
              await supabase.from("device_fingerprints").upsert({
                user_id: sessionData.user.id,
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

          setGoogleLoading(false);
          dismiss();
          return;
        }
      }

      // User cancelled or no tokens
      setGoogleLoading(false);
    } catch (e: any) {
      setError(e.message || "Google sign-in failed.");
      setGoogleLoading(false);
    }
  };

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

    // Register with Supabase — use the admin-friendly signUp
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

    // If we got a session, we're done
    if (data.session) {
      // Register device fingerprint
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
      setLoading(false);
      dismiss();
      return;
    }

    // No session — Supabase has email confirmation on at the server level.
    // Sign up succeeded but user can't sign in until confirmed.
    // Workaround: try signing in anyway (works if confirm is actually off)
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email: trimEmail,
      password: trimPassword,
    });

    if (signInErr) {
      // If it's the email confirmation error, give a clear message
      const msg = signInErr.message.toLowerCase();
      if (msg.includes("email") && msg.includes("confirm")) {
        setError("Email confirmation is blocking sign-in. Go to Supabase > Authentication > Providers > Email and make sure 'Confirm email' is toggled OFF, then try again.");
      } else if (msg.includes("invalid")) {
        setError("Account may not have been created. Check Supabase Auth > Users. If not there, the database trigger may be blocking it — run: DROP TRIGGER IF EXISTS trg_update_trust_level ON profiles;");
      } else {
        setError(signInErr.message);
      }
      setLoading(false);
      return;
    }

    // Sign in worked — register device
    if (signInData.user) {
      try {
        await supabase.from("device_fingerprints").upsert({
          user_id: signInData.user.id,
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
                style={({ pressed }) => [styles.googleBtn, pressed && styles.btnPressed]}
                onPress={handleGoogleSignIn}
                disabled={googleLoading}
              >
                {googleLoading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <>
                    <Svg width={20} height={20} viewBox="0 0 48 48">
                      <Path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107" />
                      <Path d="M5.3 14.7l7.1 5.2C14.1 16.2 18.7 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 15.4 2 8.1 7.3 5.3 14.7z" fill="#FF3D00" />
                      <Path d="M24 46c5.4 0 10.3-1.8 14.1-5l-6.5-5.5C29.6 37.1 27 38 24 38c-6 0-11.1-4-12.8-9.5l-7 5.4C7 41 14.7 46 24 46z" fill="#4CAF50" />
                      <Path d="M44.5 20H24v8.5h11.8c-.9 2.7-2.6 5-4.8 6.5l6.5 5.5C41 37.4 46 31.5 46 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2" />
                    </Svg>
                    <Text style={styles.googleBtnText}>Continue with Google</Text>
                  </>
                )}
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

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

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              style={({ pressed }) => [styles.googleBtn, pressed && styles.btnPressed]}
              onPress={handleGoogleSignIn}
              disabled={googleLoading}
            >
              {googleLoading ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <>
                  <Text style={styles.googleIcon}>G</Text>
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                </>
              )}
            </Pressable>

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
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#fff",
    paddingVertical: 13,
    borderRadius: radius.lg,
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: "700",
    color: "#4285F4",
  },
  googleBtnText: {
    color: "#1f1f1f",
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginVertical: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: fontSize.xs,
    color: colors.textDim,
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
});

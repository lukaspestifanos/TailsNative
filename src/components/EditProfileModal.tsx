import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as Haptics from "expo-haptics";
import { supabase } from "../lib/supabase";
import { colors, fontSize, spacing, radius } from "../lib/theme";

type ProfileData = {
  id: string;
  username: string;
  name: string | null;
  bio: string | null;
  avatar_url: string | null;
  username_changed_at: string | null;
};

type Props = {
  visible: boolean;
  profile: ProfileData;
  onClose: () => void;
  onSaved: (updated: { username: string; name: string | null; bio: string | null; avatar_url: string | null }) => void;
  onDeleteAccount?: () => void;
};

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "cooldown";

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const USERNAME_COOLDOWN_DAYS = 14;

export default function EditProfileModal({ visible, profile, onClose, onSaved, onDeleteAccount }: Props) {
  const [name, setName] = useState(profile.name || "");
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [saving, setSaving] = useState(false);

  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalUsername = useRef(profile.username);

  // Reset state when modal opens with fresh profile data
  useEffect(() => {
    if (visible) {
      setName(profile.name || "");
      setUsername(profile.username);
      setBio(profile.bio || "");
      setAvatarUrl(profile.avatar_url);
      setUsernameStatus("idle");
      setSaving(false);
      setAvatarUploading(false);
      originalUsername.current = profile.username;
    }
  }, [visible, profile]);

  // Debounced username availability check
  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current);

    const trimmed = username.trim().toLowerCase();

    // Same as current — no check needed
    if (trimmed === originalUsername.current.toLowerCase()) {
      setUsernameStatus("idle");
      return;
    }

    if (trimmed.length < 2) {
      setUsernameStatus("invalid");
      return;
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      setUsernameStatus("invalid");
      return;
    }

    // Check cooldown
    if (profile.username_changed_at) {
      const elapsed = Date.now() - new Date(profile.username_changed_at).getTime();
      const cooldownMs = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      if (elapsed < cooldownMs) {
        setUsernameStatus("cooldown");
        return;
      }
    }

    setUsernameStatus("checking");
    checkTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", trimmed)
        .maybeSingle();

      if (data && data.id !== profile.id) {
        setUsernameStatus("taken");
      } else {
        setUsernameStatus("available");
      }
    }, 400);

    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, [username, profile.id, profile.username_changed_at]);

  // Pick & upload avatar
  const pickAvatar = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      exif: false,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setAvatarUploading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const isGif = asset.uri.toLowerCase().endsWith(".gif") ||
        asset.mimeType?.includes("gif");

      let uploadUri = asset.uri;
      let ext = "jpg";
      let contentType = "image/jpeg";

      if (isGif) {
        // GIFs uploaded directly to preserve animation
        ext = "gif";
        contentType = "image/gif";
      } else {
        // Crop/resize to 400x400 JPEG
        const manipulated = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 400, height: 400 } }],
          { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
        );
        uploadUri = manipulated.uri;
      }

      const path = `${profile.id}/avatar_${Date.now()}.${ext}`;
      const response = await fetch(uploadUri);
      const arrayBuffer = await response.arrayBuffer();

      const { error: uploadErr } = await supabase.storage
        .from("post-media")
        .upload(path, arrayBuffer, {
          cacheControl: "3600",
          upsert: false,
          contentType,
        });

      if (uploadErr) {
        Alert.alert("Upload Error", uploadErr.message);
      } else {
        const { data } = supabase.storage.from("post-media").getPublicUrl(path);
        setAvatarUrl(data.publicUrl);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to upload avatar");
    }

    setAvatarUploading(false);
  }, [profile.id]);

  // Save profile
  const handleSave = useCallback(async () => {
    const trimmedUsername = username.trim().toLowerCase();
    const trimmedName = name.trim() || null;
    const trimmedBio = bio.trim() || null;
    const usernameChanged = trimmedUsername !== originalUsername.current.toLowerCase();

    // Validate username if changed
    if (usernameChanged) {
      if (trimmedUsername.length < 2 || !USERNAME_REGEX.test(trimmedUsername)) {
        Alert.alert("Invalid Username", "Username must be 2-30 characters, letters, numbers, and underscores only.");
        return;
      }
      if (usernameStatus === "taken") {
        Alert.alert("Username Taken", "That username is already in use.");
        return;
      }
      if (usernameStatus === "cooldown") {
        Alert.alert("Username Cooldown", "You can only change your username once every 2 weeks.");
        return;
      }
      if (usernameStatus === "checking") {
        Alert.alert("Please Wait", "Still checking username availability.");
        return;
      }

      // Double-check availability before saving
      const { data: conflict } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", trimmedUsername)
        .maybeSingle();
      if (conflict && conflict.id !== profile.id) {
        setUsernameStatus("taken");
        Alert.alert("Username Taken", "Someone just claimed that username.");
        return;
      }
    }

    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const updates: Record<string, any> = {
      name: trimmedName,
      bio: trimmedBio,
      avatar_url: avatarUrl,
    };

    if (usernameChanged) {
      updates.username = trimmedUsername;
      updates.username_changed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", profile.id);

    if (error) {
      // Handle duplicate username at DB level
      if (error.code === "23505") {
        setUsernameStatus("taken");
        Alert.alert("Username Taken", "That username is already in use.");
      } else {
        // Retry without username_changed_at if RLS blocks it
        if (usernameChanged && error.message?.includes("username_changed_at")) {
          const { username_changed_at, ...retryUpdates } = updates;
          const { error: retryErr } = await supabase
            .from("profiles")
            .update(retryUpdates)
            .eq("id", profile.id);
          if (retryErr) {
            Alert.alert("Error", retryErr.message);
            setSaving(false);
            return;
          }
        } else {
          Alert.alert("Error", error.message);
          setSaving(false);
          return;
        }
      }
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved({
      username: usernameChanged ? trimmedUsername : profile.username,
      name: trimmedName,
      bio: trimmedBio,
      avatar_url: avatarUrl,
    });
  }, [username, name, bio, avatarUrl, usernameStatus, profile, onSaved]);

  const usernameChanged = username.trim().toLowerCase() !== originalUsername.current.toLowerCase();
  const canSave =
    !saving &&
    !avatarUploading &&
    username.trim().length >= 2 &&
    (!usernameChanged || usernameStatus === "available");

  const usernameHint = (() => {
    switch (usernameStatus) {
      case "checking": return { text: "Checking...", color: colors.textMuted };
      case "available": return { text: "Available", color: colors.emerald };
      case "taken": return { text: "Taken", color: colors.red };
      case "invalid": return { text: "Letters, numbers, underscores only (2-30)", color: colors.red };
      case "cooldown": {
        const days = Math.ceil(
          (USERNAME_COOLDOWN_DAYS * 86400000 - (Date.now() - new Date(profile.username_changed_at!).getTime())) / 86400000
        );
        return { text: `Can change in ${days}d`, color: colors.yellow };
      }
      default: return null;
    }
  })();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
          <Text style={s.headerTitle}>Edit Profile</Text>
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
          >
            {saving ? (
              <ActivityIndicator color={colors.black} size="small" />
            ) : (
              <Text style={s.saveBtnText}>Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={s.body}
          contentContainerStyle={s.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar */}
          <View style={s.avatarSection}>
            <Pressable onPress={pickAvatar} disabled={avatarUploading}>
              <View style={s.avatarWrap}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={s.avatar} contentFit="cover" />
                ) : (
                  <View style={s.avatarFallback}>
                    <Text style={s.avatarLetter}>
                      {(username || "?")[0].toUpperCase()}
                    </Text>
                  </View>
                )}
                {avatarUploading && (
                  <View style={s.avatarOverlay}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
              </View>
              <Text style={s.changePhotoText}>
                {avatarUploading ? "Uploading..." : "Change Photo"}
              </Text>
            </Pressable>
          </View>

          {/* Display Name */}
          <View style={s.field}>
            <Text style={s.label}>Display Name</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={(t) => t.length <= 50 && setName(t)}
              placeholder="Display name"
              placeholderTextColor={colors.textDim}
              maxLength={50}
              autoCorrect={false}
              returnKeyType="next"
            />
            <Text style={s.charCount}>{name.length}/50</Text>
          </View>

          {/* Username */}
          <View style={s.field}>
            <Text style={s.label}>Username</Text>
            <View style={s.usernameRow}>
              <Text style={s.atSymbol}>@</Text>
              <TextInput
                style={[s.input, s.usernameInput]}
                value={username}
                onChangeText={(t) => {
                  const cleaned = t.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30);
                  setUsername(cleaned);
                }}
                placeholder="username"
                placeholderTextColor={colors.textDim}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              {usernameStatus === "checking" && (
                <ActivityIndicator color={colors.textMuted} size="small" style={s.usernameSpinner} />
              )}
            </View>
            {usernameHint && (
              <Text style={[s.hint, { color: usernameHint.color }]}>{usernameHint.text}</Text>
            )}
          </View>

          {/* Bio */}
          <View style={s.field}>
            <Text style={s.label}>Bio</Text>
            <TextInput
              style={[s.input, s.bioInput]}
              value={bio}
              onChangeText={(t) => t.length <= 160 && setBio(t)}
              placeholder="Tell us about yourself"
              placeholderTextColor={colors.textDim}
              maxLength={160}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <Text style={s.charCount}>{bio.length}/160</Text>
          </View>

          {/* Delete Account */}
          {onDeleteAccount && (
            <View style={s.dangerZone}>
              <View style={s.dangerDivider} />
              <Pressable
                onPress={onDeleteAccount}
                style={({ pressed }) => [s.deleteBtn, pressed && s.deleteBtnPressed]}
              >
                <Text style={s.deleteBtnText}>Delete Account</Text>
              </Pressable>
              <Text style={s.deleteHint}>
                Permanently delete your account and all associated data. This cannot be undone.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cancelText: { fontSize: fontSize.md, color: colors.textMuted, fontWeight: "600" },
  headerTitle: { fontSize: fontSize.md, fontWeight: "700", color: colors.text },
  saveBtn: {
    backgroundColor: colors.emerald,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: colors.black, fontSize: fontSize.sm, fontWeight: "700" },

  // Body
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: 60 },

  // Avatar
  avatarSection: { alignItems: "center", marginBottom: spacing.xl },
  avatarWrap: { position: "relative" },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarFallback: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.cardHover,
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: { fontSize: 36, fontWeight: "700", color: colors.emerald },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 48,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center",
  },
  changePhotoText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.emerald,
    textAlign: "center",
    marginTop: spacing.sm,
  },

  // Fields
  field: { marginBottom: spacing.xl },
  label: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: fontSize.md,
    color: colors.text,
  },
  bioInput: {
    minHeight: 80,
    paddingTop: 12,
  },
  charCount: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textAlign: "right",
    marginTop: 4,
    fontVariant: ["tabular-nums"],
  },

  // Username
  usernameRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
  },
  atSymbol: { fontSize: fontSize.md, color: colors.textMuted, fontWeight: "600" },
  usernameInput: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: 0,
    paddingLeft: 2,
  },
  usernameSpinner: { marginRight: spacing.md },
  hint: { fontSize: fontSize.xs, marginTop: 4 },

  // Danger zone
  dangerZone: {
    marginTop: spacing.xl,
    paddingTop: spacing.md,
  },
  dangerDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  deleteBtn: {
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
  },
  deleteBtnPressed: {
    opacity: 0.7,
  },
  deleteBtnText: {
    fontSize: fontSize.md,
    fontWeight: "600" as const,
    color: "#ef4444",
  },
  deleteHint: {
    fontSize: fontSize.xs,
    color: colors.textDim,
    textAlign: "center" as const,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
});

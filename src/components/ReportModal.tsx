import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { colors, fontSize, spacing, radius } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

export type ReportTarget =
  | { type: "post"; id: string; authorId: string }
  | { type: "comment"; id: string; authorId: string }
  | { type: "user"; id: string };

interface ReportModalProps {
  visible: boolean;
  target: ReportTarget | null;
  onClose: () => void;
  onSubmitted?: () => void;
}

const REASONS = [
  { id: "spam", label: "Spam or scam" },
  { id: "harassment", label: "Harassment or bullying" },
  { id: "hate_speech", label: "Hate speech or discrimination" },
  { id: "violence", label: "Violence or threats" },
  { id: "sexual_content", label: "Sexual or explicit content" },
  { id: "self_harm", label: "Self-harm or suicide" },
  { id: "impersonation", label: "Impersonation" },
  { id: "illegal", label: "Illegal activity" },
  { id: "misinformation", label: "Misinformation" },
  { id: "other", label: "Other" },
];

export default function ReportModal({ visible, target, onClose, onSubmitted }: ReportModalProps) {
  const { user } = useAuth();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setReason(null);
    setDetails("");
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!user || !target || !reason) return;
    setSubmitting(true);

    const payload: any = {
      reporter_id: user.id,
      reason,
      details: details.trim() || null,
      status: "pending",
    };

    if (target.type === "post") {
      payload.target_type = "post";
      payload.target_post_id = target.id;
      payload.target_user_id = target.authorId;
    } else if (target.type === "comment") {
      payload.target_type = "comment";
      payload.target_comment_id = target.id;
      payload.target_user_id = target.authorId;
    } else {
      payload.target_type = "user";
      payload.target_user_id = target.id;
    }

    const { error } = await supabase.from("reports").insert(payload);

    if (error) {
      Alert.alert("Error", error.message || "Failed to submit report.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    reset();
    onClose();
    Alert.alert(
      "Report submitted",
      "Thank you. Our moderation team reviews reports within 24 hours and will take action on objectionable content.",
    );
    onSubmitted?.();
  };

  const targetLabel =
    target?.type === "post"
      ? "this post"
      : target?.type === "comment"
        ? "this comment"
        : "this user";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />

            <Text style={styles.title}>Report {targetLabel}</Text>
            <Text style={styles.subtitle}>
              Reports are reviewed within 24 hours. Tails has zero tolerance for objectionable
              content or abusive users.
            </Text>

            <ScrollView
              style={styles.reasonList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {REASONS.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => setReason(r.id)}
                  style={({ pressed }) => [
                    styles.reasonRow,
                    reason === r.id && styles.reasonRowActive,
                    pressed && styles.reasonRowPressed,
                  ]}
                >
                  <View style={[styles.radio, reason === r.id && styles.radioActive]}>
                    {reason === r.id && <View style={styles.radioDot} />}
                  </View>
                  <Text style={[styles.reasonLabel, reason === r.id && styles.reasonLabelActive]}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}

              {reason && (
                <View style={styles.detailsWrap}>
                  <Text style={styles.detailsLabel}>Additional details (optional)</Text>
                  <TextInput
                    style={styles.detailsInput}
                    value={details}
                    onChangeText={setDetails}
                    placeholder="Tell us more about why you're reporting this…"
                    placeholderTextColor={colors.textDim}
                    multiline
                    maxLength={500}
                    textAlignVertical="top"
                  />
                  <Text style={styles.detailsCount}>{details.length}/500</Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.actions}>
              <Pressable
                onPress={handleClose}
                style={({ pressed }) => [styles.cancelBtn, pressed && styles.btnPressed]}
                disabled={submitting}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSubmit}
                style={({ pressed }) => [
                  styles.submitBtn,
                  (!reason || submitting) && styles.submitBtnDisabled,
                  pressed && styles.btnPressed,
                ]}
                disabled={!reason || submitting}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.text} size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Submit Report</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl + 8,
    maxHeight: "85%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  reasonList: {
    maxHeight: 380,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  reasonRowActive: {
    backgroundColor: colors.emeraldBg,
  },
  reasonRowPressed: {
    opacity: 0.7,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioActive: {
    borderColor: colors.emerald,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.emerald,
  },
  reasonLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    flex: 1,
  },
  reasonLabelActive: {
    color: colors.text,
    fontWeight: "600",
  },
  detailsWrap: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  detailsLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  detailsInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.text,
    minHeight: 80,
  },
  detailsCount: {
    fontSize: 10,
    color: colors.textDim,
    textAlign: "right",
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.text,
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.lg,
    alignItems: "center",
    backgroundColor: colors.red,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    fontSize: fontSize.md,
    fontWeight: "700",
    color: colors.text,
  },
  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});

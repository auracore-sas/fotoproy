import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Edge } from 'react-native-safe-area-context';

export const colors = {
  primary: '#1D4ED8',
  primaryPressed: '#1E40AF',
  primarySoft: '#EFF6FF',
  primaryBorder: '#BFDBFE',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  dangerBorder: '#FECACA',
  success: '#16A34A',
  successSoft: '#F0FDF4',
  warn: '#B45309',
  warnSoft: '#FEF3C7',
  warnBorder: '#FDE68A',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  border: '#E2E8F0',
  text: '#0F172A',
  textMuted: '#64748B',
};

export const textStyles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 15, color: colors.textMuted, marginTop: 4 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
});

interface ScreenProps extends ViewProps {
  edges?: Edge[];
}

export function Screen({ children, style, edges = ['top', 'bottom'] }: ScreenProps) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

export function Button({ title, onPress, loading, variant = 'primary', disabled }: ButtonProps) {
  const bg =
    variant === 'danger'
      ? colors.danger
      : variant === 'secondary'
        ? colors.surface
        : colors.primary;
  const fg = variant === 'secondary' ? colors.primary : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg },
        variant === 'secondary' && styles.buttonSecondary,
        (pressed || disabled || loading) && { opacity: 0.7 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export function Field({ label, error, style, ...inputProps }: FieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={textStyles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor={colors.textMuted}
        {...inputProps}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export type BannerTone = 'info' | 'warn' | 'error' | 'success';

const bannerTones: Record<BannerTone, { bg: string; border: string; text: string; icon: string }> = {
  info: { bg: colors.primarySoft, border: colors.primaryBorder, text: colors.primary, icon: 'ℹ️' },
  warn: { bg: colors.warnSoft, border: colors.warnBorder, text: colors.warn, icon: '⚠️' },
  error: { bg: colors.dangerSoft, border: colors.dangerBorder, text: colors.danger, icon: '⛔' },
  success: { bg: colors.successSoft, border: '#BBF7D0', text: colors.success, icon: '✅' },
};

interface BannerProps {
  message: string | null;
  tone?: BannerTone;
  icon?: string | null;
  /** Replaces the icon with a spinner (e.g. “uploading…” states). */
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewProps['style'];
}

/** Inline message strip (offline notices, form errors, warnings). */
export function Banner({
  message,
  tone = 'info',
  icon,
  loading,
  actionLabel,
  onAction,
  style,
}: BannerProps) {
  if (!message) {
    return null;
  }
  const theme = bannerTones[tone];
  const glyph = icon === undefined ? theme.icon : icon;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: theme.bg, borderColor: theme.border }, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={theme.text} />
      ) : glyph ? (
        <Text style={styles.bannerIcon}>{glyph}</Text>
      ) : null}
      <Text style={[styles.bannerText, { color: theme.text }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={6}
          style={({ pressed }) => [styles.bannerAction, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.bannerActionText, { color: theme.text }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Backwards-compatible error strip used by forms and screens. */
export function ErrorBanner({
  message,
  actionLabel,
  onAction,
}: {
  message: string | null;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return <Banner message={message} tone="error" actionLabel={actionLabel} onAction={onAction} />;
}

interface EmptyStateProps {
  icon?: string;
  title: string;
  text?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Centered “nothing here yet” block with an optional call to action. */
export function EmptyState({ icon = '📭', title, text, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <Text style={styles.emptyIcon}>{icon}</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.emptyAction}>
          <Button title={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/** Screen-level failure with a manual retry action (F4.3). */
export function ErrorState({
  title = 'No se pudo cargar',
  message,
  onRetry,
  retryLabel = 'Reintentar',
}: ErrorStateProps) {
  return (
    <EmptyState
      icon="📡"
      title={title}
      text={message}
      actionLabel={onRetry ? retryLabel : undefined}
      onAction={onRetry}
    />
  );
}

export function CenterLoader() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  button: {
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonSecondary: { borderWidth: 1, borderColor: colors.primary },
  buttonText: { fontSize: 16, fontWeight: '600' },
  fieldGroup: { marginBottom: 16 },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  bannerIcon: { fontSize: 14 },
  bannerText: { fontSize: 14, flex: 1, lineHeight: 19 },
  bannerAction: { paddingHorizontal: 4, paddingVertical: 2 },
  bannerActionText: { fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 72, paddingHorizontal: 28 },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyIcon: { fontSize: 28 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyAction: { marginTop: 18, alignSelf: 'stretch', width: '100%' },
});

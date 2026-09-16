/**
 * FotoProy design system — “industrial blueprint”.
 *
 * Principles: high contrast for outdoor field use, generous touch targets,
 * quiet chrome so photos and plans stay the protagonists, and a technical
 * typographic voice (Space Grotesk for display, Manrope for UI text).
 */
import React, { useState } from 'react';
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

/* -------------------------------------------------------------------------- */
/* Tokens                                                                     */
/* -------------------------------------------------------------------------- */

export const colors = {
  // Brand: blueprint blue
  primary: '#2563EB',
  primaryPressed: '#1D4ED8',
  primaryDeep: '#1E3A8A',
  primarySoft: '#EAF0FF',
  primaryBorder: '#C7D7FE',

  // Construction accent (safety amber)
  accent: '#F59E0B',
  accentInk: '#8A4B00',
  accentSoft: '#FFF5E3',
  accentBorder: '#FBD9A3',

  // Semantic
  success: '#0E9F6E',
  successSoft: '#E8F7F1',
  successBorder: '#A9E8D0',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  dangerBorder: '#F8C3C3',
  warn: '#B45309',
  warnSoft: '#FEF3C7',
  warnBorder: '#FDE68A',

  // Neutrals
  ink: '#0A1020',
  text: '#151B2B',
  textMuted: '#5A6579',
  textFaint: '#8B94A7',
  line: '#E7EAF2',
  lineStrong: '#D5DAE6',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F5FB',
  bg: '#F5F7FC',

  // Backwards-compatible aliases
  border: '#E7EAF2',
};

export const fonts = {
  display: 'SpaceGrotesk_600SemiBold',
  displayMedium: 'SpaceGrotesk_500Medium',
  displayBold: 'SpaceGrotesk_700Bold',
  sans: 'Manrope_400Regular',
  sansMedium: 'Manrope_500Medium',
  sansSemiBold: 'Manrope_600SemiBold',
  sansBold: 'Manrope_700Bold',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };
export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };

export const elevations = {
  card: {
    shadowColor: '#0A1020',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#0A1020',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
};

export const textStyles = StyleSheet.create({
  display: {
    fontFamily: fonts.displayBold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.7,
    color: colors.ink,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: colors.text },
  bodyStrong: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  subtitle: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: colors.textMuted },
  caption: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  micro: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    color: colors.textFaint,
    textTransform: 'uppercase',
  },
  label: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    color: colors.text,
    marginBottom: 6,
  },
});

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

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

interface CardProps extends ViewProps {
  onPress?: () => void;
  accessibilityLabel?: string;
}

/** Surface with a hairline border; pressable when `onPress` is given. */
export function Card({ children, style, onPress, accessibilityLabel }: CardProps) {
  if (!onPress) {
    return <View style={[styles.card, style]}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.card, style, pressed && styles.cardPressed]}
    >
      {children}
    </Pressable>
  );
}

export function SectionLabel({
  children,
  style,
}: {
  children: string;
  style?: ViewProps['style'];
}) {
  return (
    <View style={[styles.sectionLabelRow, style]}>
      <Text style={textStyles.micro}>{children}</Text>
      <View style={styles.sectionLabelRule} />
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name?: string | null; size?: number }) {
  const initials =
    (name ?? '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '•';
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

/** Geometric brand mark: a blueprint tile with a focus reticle. */
export function BrandMark({ size = 72 }: { size?: number }) {
  const line = Math.max(1, Math.round(size * 0.014));
  const gridInset = size * 0.22;
  return (
    <View style={[styles.brandMark, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <View
        style={[
          styles.brandLine,
          { left: gridInset, width: line, top: gridInset, bottom: gridInset },
        ]}
      />
      <View
        style={[
          styles.brandLine,
          { right: gridInset, width: line, top: gridInset, bottom: gridInset },
        ]}
      />
      <View
        style={[
          styles.brandLine,
          { top: gridInset, height: line, left: gridInset, right: gridInset },
        ]}
      />
      <View
        style={[
          styles.brandLine,
          { bottom: gridInset, height: line, left: gridInset, right: gridInset },
        ]}
      />
      <View
        style={[
          styles.brandReticle,
          {
            width: size * 0.34,
            height: size * 0.34,
            borderRadius: size * 0.17,
            borderWidth: Math.max(2, size * 0.035),
          },
        ]}
      >
        <View
          style={{
            width: size * 0.08,
            height: size * 0.08,
            borderRadius: size * 0.04,
            backgroundColor: colors.accent,
          }}
        />
      </View>
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={textStyles.micro} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: string;
}

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  size = 'md',
  icon,
}: ButtonProps) {
  const palette = {
    primary: { bg: colors.primary, border: colors.primary, fg: '#FFFFFF' },
    secondary: { bg: colors.surface, border: colors.lineStrong, fg: colors.text },
    ghost: { bg: 'transparent', border: 'transparent', fg: colors.primary },
    danger: { bg: colors.danger, border: colors.danger, fg: '#FFFFFF' },
  }[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : styles.buttonMd,
        variant === 'primary' && !inactive ? elevations.card : null,
        { backgroundColor: palette.bg, borderColor: palette.border },
        variant === 'primary' && { backgroundColor: pressed ? colors.primaryPressed : palette.bg },
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? (
            <Text
              style={[
                styles.buttonIcon,
                size === 'sm' && styles.buttonIconSm,
                { color: palette.fg },
              ]}
            >
              {icon}
            </Text>
          ) : null}
          <Text
            style={[styles.buttonText, size === 'sm' && styles.buttonTextSm, { color: palette.fg }]}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

interface RoundButtonProps {
  glyph: string;
  onPress: () => void;
  label: string;
  tone?: 'light' | 'dark' | 'primary';
  size?: number;
}

/** Circular icon button for headers and floating controls. */
export function RoundButton({
  glyph,
  onPress,
  label,
  tone = 'light',
  size = 42,
}: RoundButtonProps) {
  const palette = {
    light: { bg: colors.surface, fg: colors.text, border: colors.line },
    dark: { bg: 'rgba(10,16,32,0.55)', fg: '#FFFFFF', border: 'rgba(255,255,255,0.18)' },
    primary: { bg: colors.primarySoft, fg: colors.primary, border: colors.primaryBorder },
  }[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.roundButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.bg,
          borderColor: palette.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.roundButtonGlyph, { color: palette.fg, fontSize: size * 0.42 }]}>
        {glyph}
      </Text>
    </Pressable>
  );
}

interface FilterChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function FilterChip({ label, active, onPress, disabled }: FilterChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                      */
/* -------------------------------------------------------------------------- */

interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export function Field({ label, error, style, ...inputProps }: FieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <Text style={textStyles.label}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          focused && styles.inputFocused,
          error ? styles.inputError : null,
          style,
        ]}
        placeholderTextColor={colors.textFaint}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        {...inputProps}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

export type BannerTone = 'info' | 'warn' | 'error' | 'success';

const bannerTones: Record<
  BannerTone,
  { bg: string; border: string; text: string; iconBg: string; icon: string }
> = {
  info: {
    bg: colors.primarySoft,
    border: colors.primaryBorder,
    text: colors.primaryDeep,
    iconBg: '#FFFFFF',
    icon: 'ℹ️',
  },
  warn: {
    bg: colors.accentSoft,
    border: colors.accentBorder,
    text: colors.accentInk,
    iconBg: '#FFFFFF',
    icon: '⚠️',
  },
  error: {
    bg: colors.dangerSoft,
    border: colors.dangerBorder,
    text: '#9F1239',
    iconBg: '#FFFFFF',
    icon: '⛔',
  },
  success: {
    bg: colors.successSoft,
    border: colors.successBorder,
    text: '#065F46',
    iconBg: '#FFFFFF',
    icon: '✅',
  },
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
        <View style={[styles.bannerIconWrap, { backgroundColor: theme.iconBg }]}>
          <Text style={styles.bannerIcon}>{glyph}</Text>
        </View>
      ) : null}
      <Text style={[styles.bannerText, { color: theme.text }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => [
            styles.bannerAction,
            { borderColor: theme.text },
            pressed && styles.pressed,
          ]}
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
  tone?: 'brand' | 'error';
}

/** Centered “nothing here yet” block with an optional call to action. */
export function EmptyState({
  icon = '📭',
  title,
  text,
  actionLabel,
  onAction,
  tone = 'brand',
}: EmptyStateProps) {
  const palette =
    tone === 'error'
      ? { bg: colors.dangerSoft, border: colors.dangerBorder }
      : { bg: colors.primarySoft, border: colors.primaryBorder };
  return (
    <View style={styles.empty}>
      <View
        style={[styles.emptyIconWrap, { backgroundColor: palette.bg, borderColor: palette.border }]}
      >
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

/** Screen-level failure with a manual retry action. */
export function ErrorState({
  title = 'No se pudo cargar',
  message,
  onRetry,
  retryLabel = 'Reintentar',
}: ErrorStateProps) {
  return (
    <EmptyState
      icon="📡"
      tone="error"
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

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  cardPressed: { backgroundColor: colors.surfaceAlt, transform: [{ scale: 0.995 }] },

  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sectionLabelRule: { flex: 1, height: 1, backgroundColor: colors.line },

  avatar: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.displayBold, color: colors.primaryDeep },

  brandMark: { backgroundColor: colors.primary, overflow: 'hidden' },
  brandLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.22)' },
  brandReticle: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -0,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -0.5 }],
  },

  stat: { flex: 1, gap: 3 },
  statValue: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: colors.ink,
  },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 18,
  },
  buttonMd: { height: 52 },
  buttonSm: { height: 40, paddingHorizontal: 14 },
  buttonText: { fontFamily: fonts.sansBold, fontSize: 16, letterSpacing: 0.1 },
  buttonTextSm: { fontSize: 13.5 },
  buttonIcon: { fontSize: 17 },
  buttonIconSm: { fontSize: 14 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.5 },

  roundButton: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  roundButtonGlyph: { fontFamily: fonts.sansSemiBold },

  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.text },
  chipTextActive: { color: '#FFFFFF' },

  fieldGroup: { marginBottom: 16 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 15.5,
    fontFamily: fonts.sansMedium,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputFocused: { borderColor: colors.primary, backgroundColor: '#FFFFFF' },
  inputError: { borderColor: colors.danger },
  errorText: { fontFamily: fonts.sansMedium, color: colors.danger, fontSize: 13, marginTop: 5 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  bannerIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerIcon: { fontSize: 13 },
  bannerText: { fontFamily: fonts.sansMedium, fontSize: 13.5, flex: 1, lineHeight: 19 },
  bannerAction: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  bannerActionText: { fontFamily: fonts.sansBold, fontSize: 12.5 },

  empty: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 26 },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyIcon: { fontSize: 32 },
  emptyTitle: { ...textStyles.title, fontSize: 19, textAlign: 'center' },
  emptyText: {
    ...textStyles.subtitle,
    marginTop: 6,
    textAlign: 'center',
  },
  emptyAction: { marginTop: 20, alignSelf: 'stretch', width: '100%' },
});

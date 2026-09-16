import { Link } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BrandMark,
  Button,
  colors,
  ErrorBanner,
  Field,
  fonts,
  radius,
  elevations,
  Screen,
  textStyles,
} from '../../components/ui';
import { errorMessage, useAuth } from '../../lib/auth';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      // The (auth) layout redirects to the app once the session is stored.
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      {/* Atmospheric backdrop: blueprint glow */}
      <View pointerEvents="none" style={styles.glow} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <BrandMark size={68} />
            <Text style={styles.wordmark}>FotoProy</Text>
            <Text style={styles.tagline}>Documenta cada paso de la obra</Text>
          </View>

          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Inicia sesión</Text>
            <Text style={styles.sheetSubtitle}>Entra con tu cuenta de la organización</Text>

            <ErrorBanner message={error} />

            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="nombre@empresa.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Field
              label="Contraseña"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              textContentType="password"
            />

            <Button title="Entrar" onPress={onSubmit} loading={submitting} disabled={!canSubmit} />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>¿Aún no tienes cuenta? </Text>
            <Link href="/register" style={styles.link}>
              Regístrate
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  glow: {
    position: 'absolute',
    top: -90,
    right: -70,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.primarySoft,
  },
  content: { padding: 24, paddingTop: 48, flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: 28 },
  wordmark: {
    fontFamily: fonts.displayBold,
    fontSize: 30,
    letterSpacing: -0.8,
    color: colors.ink,
    marginTop: 14,
  },
  tagline: { ...textStyles.caption, marginTop: 4 },

  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 20,
    ...elevations.card,
  },
  sheetTitle: { ...textStyles.title, fontSize: 20 },
  sheetSubtitle: { ...textStyles.caption, marginTop: 3, marginBottom: 18 },

  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 22 },
  footerText: { fontFamily: fonts.sans, color: colors.textMuted },
  link: { fontFamily: fonts.sansBold, color: colors.primary },
});

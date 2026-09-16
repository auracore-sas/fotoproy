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

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    fullName.trim().length >= 2 &&
    organizationName.trim().length >= 2 &&
    email.includes('@') &&
    password.length >= 8 &&
    !submitting;

  const onSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signUp({
        fullName: fullName.trim(),
        organizationName: organizationName.trim(),
        email: email.trim(),
        password,
      });
      // The (auth) layout redirects to the app once the session is stored.
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <View pointerEvents="none" style={styles.glow} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <BrandMark size={56} />
            <Text style={styles.wordmark}>FotoProy</Text>
          </View>

          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Crea tu cuenta</Text>
            <Text style={styles.sheetSubtitle}>
              Se creará tu organización y entrarás como administrador
            </Text>

            <ErrorBanner message={error} />

            <Field
              label="Nombre completo"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Ej. María Pérez"
              autoCapitalize="words"
            />
            <Field
              label="Empresa / Organización"
              value={organizationName}
              onChangeText={setOrganizationName}
              placeholder="Ej. Constructora XYZ"
            />
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
              label="Contraseña (mín. 8 caracteres)"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              textContentType="newPassword"
            />

            <Button
              title="Crear cuenta"
              onPress={onSubmit}
              loading={submitting}
              disabled={!canSubmit}
            />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>¿Ya tienes cuenta? </Text>
            <Link href="/login" style={styles.link}>
              Inicia sesión
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
    left: -80,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.accentSoft,
  },
  content: { padding: 24, paddingTop: 40, flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', marginBottom: 22 },
  wordmark: {
    fontFamily: fonts.displayBold,
    fontSize: 26,
    letterSpacing: -0.6,
    color: colors.ink,
    marginTop: 12,
  },
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

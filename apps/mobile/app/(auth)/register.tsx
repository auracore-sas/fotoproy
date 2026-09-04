import { Link } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, colors, ErrorBanner, Field, Screen, textStyles } from '../../components/ui';
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>Crea tu cuenta</Text>
            <Text style={textStyles.subtitle}>
              Se creará tu organización con el rol de administrador
            </Text>
          </View>

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
  content: { padding: 24, justifyContent: 'center', flexGrow: 1 },
  header: { marginBottom: 24, alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { color: colors.textMuted },
  link: { color: colors.primary, fontWeight: '600' },
});

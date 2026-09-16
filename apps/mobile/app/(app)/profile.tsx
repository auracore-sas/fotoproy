import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  Banner,
  Button,
  CenterLoader,
  colors,
  elevations,
  ErrorBanner,
  Field,
  fonts,
  radius,
  Screen,
  textStyles,
} from '../../components/ui';
import { errorMessage, useAuth } from '../../lib/auth';

const MAX_SIGNATURE = 48;

export default function ProfileScreen() {
  const router = useRouter();
  const { user, updateProfile, status } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [signature, setSignature] = useState(user?.signature ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'signedIn' || !user) {
    return <CenterLoader />;
  }

  const onSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const cleanName = fullName.trim();
      const cleanSignature = signature.trim();
      await updateProfile({
        fullName: cleanName.length > 0 ? cleanName : undefined,
        signature: cleanSignature.length > 0 ? cleanSignature : null,
      });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const roleLabel =
    user.role === 'ADMIN' ? 'Administrador' : user.role === 'SUPERVISOR' ? 'Supervisor' : 'Técnico';

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Perfil' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        {/* Identity */}
        <View style={styles.identity}>
          <Avatar name={user.fullName} size={84} />
          <Text style={styles.email}>{user.email}</Text>
          <View style={styles.rolePill}>
            <Text style={styles.roleText}>{roleLabel}</Text>
            <Text style={styles.roleDot}>·</Text>
            <Text style={styles.roleText}>{user.organizationName}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Datos profesionales</Text>
        <View style={styles.card}>
          <Field
            label="Nombre completo"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Nombre y apellido"
            maxLength={255}
          />
          <Field
            label={`Firma para la estampa (${signature.length}/${MAX_SIGNATURE})`}
            value={signature}
            onChangeText={setSignature}
            placeholder="Ej.: Arq. P. Valarezo · PVA"
            maxLength={MAX_SIGNATURE}
          />
          <Text style={styles.hint}>
            Texto corto que aparece en la estampa quemada sobre cada foto que captures.
          </Text>
        </View>

        {/* Stamp preview */}
        <Text style={styles.sectionLabel}>Así se verá en la foto</Text>
        <View style={styles.preview}>
          <Text style={styles.previewMeta}>ESTAMPA · VISTA PREVIA</Text>
          <Text style={styles.previewLine}>🏗️ PROY-01 · 2026-09-05 13:20 UTC</Text>
          <Text style={styles.previewLine}>📍 -0.177234, -78.489102 · 2834 m</Text>
          <Text style={styles.previewSignature}>✒️ {signature.trim() || user.fullName}</Text>
        </View>

        {saved ? <Banner tone="success" message="Perfil actualizado" /> : null}

        <Button
          title={saving ? 'Guardando…' : 'Guardar cambios'}
          onPress={() => void onSave()}
          loading={saving}
        />
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>← Volver</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 44 },
  identity: { alignItems: 'center', marginTop: 8, marginBottom: 24 },
  email: { ...textStyles.heading, fontSize: 17, marginTop: 12 },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  roleText: { fontFamily: fonts.sansSemiBold, fontSize: 12.5, color: colors.primaryDeep },
  roleDot: { color: colors.primaryDeep, opacity: 0.6 },

  sectionLabel: { ...textStyles.micro, marginBottom: 10 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    paddingBottom: 4,
    marginBottom: 24,
    ...elevations.card,
  },
  hint: { ...textStyles.caption, fontSize: 12.5, marginTop: -6, marginBottom: 12 },

  preview: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 24,
  },
  previewMeta: {
    ...textStyles.micro,
    color: '#7C8AA8',
    marginBottom: 10,
  },
  previewLine: { fontFamily: fonts.sansMedium, color: '#D7DEEC', fontSize: 13, lineHeight: 21 },
  previewSignature: {
    fontFamily: fonts.display,
    color: colors.accent,
    fontSize: 14,
    lineHeight: 22,
  },
  back: { alignItems: 'center', marginTop: 16 },
  backText: { fontFamily: fonts.sansSemiBold, color: colors.textMuted, fontSize: 14 },
});

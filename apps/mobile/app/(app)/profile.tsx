import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, CenterLoader, colors, ErrorBanner, Screen } from '../../components/ui';
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

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Perfil' }} />
      <ScrollView contentContainerStyle={styles.padded} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user.fullName || '?').charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.email}>{user.email}</Text>
        <Text style={styles.role}>
          {user.role === 'ADMIN'
            ? 'Administrador'
            : user.role === 'SUPERVISOR'
              ? 'Supervisor'
              : 'Técnico'}{' '}
          · {user.organizationName}
        </Text>

        <Text style={styles.label}>Nombre completo</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          style={styles.input}
          placeholder="Nombre y apellido"
          placeholderTextColor={colors.textMuted}
          maxLength={255}
        />

        <Text style={styles.label}>Firma profesional (se muestra en las fotos)</Text>
        <TextInput
          value={signature}
          onChangeText={setSignature}
          style={styles.input}
          placeholder="Ej.: Arq. P. Valarezo · PVA · Patricio V."
          placeholderTextColor={colors.textMuted}
          maxLength={MAX_SIGNATURE}
        />
        <Text style={styles.hint}>
          Texto corto (apodo, iniciales o nombre corto). Aparece en la estampa que se quema sobre
          las fotos que captures. {signature.length}/{MAX_SIGNATURE}
        </Text>

        <View style={styles.previewBox}>
          <Text style={styles.previewLabel}>Así se verá en la foto:</Text>
          <Text style={styles.previewText}>
            🏗️ PROY-01 · 2026-09-05 13:20 UTC{'\n'}📍 -0.177234, -78.489102 · 2834 m{'\n'}
            ✒️ {signature.trim() || user.fullName}
          </Text>
        </View>

        {saved ? <Text style={styles.saved}>✓ Perfil actualizado</Text> : null}

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
  padded: { padding: 20, paddingBottom: 40 },
  avatar: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  avatarText: { color: '#FFFFFF', fontSize: 30, fontWeight: '700' },
  email: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginTop: 12,
  },
  role: { textAlign: 'center', fontSize: 13, color: colors.textMuted, marginTop: 4 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 22,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 16 },
  previewBox: {
    marginTop: 24,
    marginBottom: 20,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
  },
  previewLabel: { color: '#94A3B8', fontSize: 12, marginBottom: 8 },
  previewText: { color: '#E2E8F0', fontSize: 13, lineHeight: 21 },
  saved: { color: '#059669', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  back: { alignItems: 'center', marginTop: 16 },
  backText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});

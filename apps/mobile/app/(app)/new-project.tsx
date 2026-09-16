import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { Button, ErrorBanner, Field, Screen, textStyles } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';

export default function NewProjectScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = code.trim().length > 0 && name.trim().length >= 2 && !submitting;

  const onSubmit = async () => {
    if (!canSubmit || !token) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createProject(token, {
        code: code.trim(),
        name: name.trim(),
        clientName: clientName.trim() || undefined,
        description: description.trim() || undefined,
      });
      router.back();
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
          <Text style={styles.intro}>
            Crea un proyecto por obra. Dentro podrás subir planos, tomar fotos, anclar evidencias y
            compartir el avance.
          </Text>
          <ErrorBanner message={error} />
          <Field
            label="Código de obra *"
            value={code}
            onChangeText={setCode}
            placeholder="Ej. OBR-001"
            autoCapitalize="characters"
          />
          <Field
            label="Nombre del proyecto *"
            value={name}
            onChangeText={setName}
            placeholder="Ej. Edificio Aurora"
          />
          <Field
            label="Cliente"
            value={clientName}
            onChangeText={setClientName}
            placeholder="Ej. Inmobiliaria Sol"
          />
          <Field
            label="Descripción"
            value={description}
            onChangeText={setDescription}
            placeholder="Detalles del proyecto (opcional)"
            multiline
            numberOfLines={4}
            style={styles.multiline}
          />
          <Button
            title="Guardar proyecto"
            onPress={onSubmit}
            loading={submitting}
            disabled={!canSubmit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20 },
  intro: { ...textStyles.subtitle, marginBottom: 20 },
  multiline: { height: 96, textAlignVertical: 'top', paddingTop: 12 },
});

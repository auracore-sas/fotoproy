import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CenterLoader, colors, ErrorBanner, Screen, textStyles } from '../../../components/ui';
import { api } from '../../../lib/api';
import { errorMessage, useAuth } from '../../../lib/auth';
import type { Project } from '../../../lib/types';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !id) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProject(token, id);
      setProject(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const location =
    project?.latitude != null && project.longitude != null
      ? `${Number(project.latitude).toFixed(5)}, ${Number(project.longitude).toFixed(5)}`
      : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: project?.code ?? 'Proyecto' }} />
      {loading ? (
        <CenterLoader />
      ) : error ? (
        <View style={styles.padded}>
          <ErrorBanner message={error} />
        </View>
      ) : project ? (
        <ScrollView contentContainerStyle={styles.padded}>
          <Text style={textStyles.title}>{project.name}</Text>
          {project.description ? (
            <Text style={styles.description}>{project.description}</Text>
          ) : null}

          <View style={styles.card}>
            <Row label="Código" value={project.code} />
            <Row label="Cliente" value={project.clientName ?? '—'} />
            <Row label="Ubicación" value={location ?? '—'} />
            <Row label="Creado" value={formatDate(project.createdAt)} />
          </View>

          <View style={styles.comingSoon}>
            <Text style={styles.comingSoonTitle}>📷 Documentación fotográfica</Text>
            <Text style={styles.comingSoonText}>
              Próximamente: capturar fotos con estampa, subir el plano de la obra y anclar cada foto
              sobre el plano. (Fase 1 — en desarrollo)
            </Text>
          </View>
        </ScrollView>
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('es-EC', { year: 'numeric', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  padded: { padding: 20 },
  description: { fontSize: 15, color: colors.textMuted, marginTop: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 20,
    padding: 16,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { fontSize: 14, color: colors.textMuted },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  comingSoon: {
    marginTop: 24,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  comingSoonTitle: { fontSize: 15, fontWeight: '700', color: colors.primary },
  comingSoonText: { fontSize: 14, color: colors.textMuted, marginTop: 6, lineHeight: 20 },
});

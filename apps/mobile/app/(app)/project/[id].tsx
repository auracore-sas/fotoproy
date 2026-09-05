import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CenterLoader, colors, ErrorBanner, Screen, textStyles } from '../../../components/ui';
import { SyncBar } from '../../../components/sync-indicator';
import { api } from '../../../lib/api';
import { errorMessage, useAuth } from '../../../lib/auth';
import { getCachedProject, listLocalPhotos, upsertCachedProject } from '../../../lib/db';
import { useSync } from '../../../lib/sync';
import type { Project } from '../../../lib/types';

export default function ProjectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [mediaCount, setMediaCount] = useState(0);
  const { online } = useSync();
  const prevOnlineRef = useRef(online);

  const load = useCallback(async () => {
    if (!token || !id) {
      return;
    }
    setLoading(true);
    setError(null);
    setOffline(false);
    try {
      const data = await api.getProject(token, id);
      setProject(data);
      // Snapshot for offline sessions.
      void upsertCachedProject(data);
    } catch (err) {
      const cached = await getCachedProject(id);
      if (cached) {
        setProject({
          id: cached.id,
          code: cached.code,
          name: cached.name,
          description: cached.description,
          clientName: cached.clientName,
          latitude: cached.latitude,
          longitude: cached.longitude,
          organizationId: cached.organizationId,
          createdAt: cached.createdAt ?? cached.updatedAt,
        });
        setOffline(true);
        return;
      }
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  // When connectivity comes back, refetch the project so the banner clears.
  useEffect(() => {
    const reconnected = online && !prevOnlineRef.current;
    prevOnlineRef.current = online;
    if (reconnected && offline) {
      void load();
    }
  }, [online, offline, load]);

  useEffect(() => {
    void load();
  }, [load]);

  // Count locally captured media (photos + videos) for the project.
  useEffect(() => {
    if (!id) {
      return;
    }
    listLocalPhotos(id)
      .then((rows) => setMediaCount(rows.length))
      .catch(() => undefined);
  }, [id]);

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
          <SyncBar />
          {offline ? (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineBannerText}>
                {online
                  ? 'No se pudo conectar al servidor: mostrando datos guardados. Reintentando…'
                  : 'Sin conexión: mostrando datos guardados. Puedes seguir tomando fotos.'}
              </Text>
            </View>
          ) : null}
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
            <Text style={styles.comingSoonTitle}>🎬 Fotos y videos de obra</Text>
            <Text style={styles.comingSoonText}>
              Toma fotos con estampa o videos cortos: se guardan al instante en el dispositivo. El
              anclaje sobre planos llega en las siguientes fases.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/capture',
                params: {
                  projectId: id,
                  projectCode: project.code,
                  projectName: project.name,
                },
              })
            }
            style={({ pressed }) => [styles.captureButton, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.captureButtonIcon}>📷</Text>
            <View style={styles.captureButtonText}>
              <Text style={styles.captureButtonTitle}>Tomar foto / video</Text>
              <Text style={styles.captureButtonSubtitle}>Documenta el avance de la obra</Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/gallery', params: { projectId: id } })}
            style={({ pressed }) => [styles.galleryButton, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.galleryButtonIcon}>🖼️</Text>
            <View style={styles.captureButtonText}>
              <Text style={styles.galleryButtonTitle}>
                Galería local · {mediaCount} {mediaCount === 1 ? 'medio' : 'medios'}
              </Text>
              <Text style={styles.galleryButtonSubtitle}>
                Fotos y videos guardados en este equipo
              </Text>
            </View>
          </Pressable>
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
  captureButton: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    padding: 18,
  },
  captureButtonIcon: { fontSize: 26, marginRight: 12 },
  captureButtonText: { flex: 1 },
  captureButtonTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  captureButtonSubtitle: { color: '#DBEAFE', fontSize: 13, marginTop: 2 },
  galleryButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  galleryButtonIcon: { fontSize: 24, marginRight: 12 },
  galleryButtonTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  galleryButtonSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  offlineBanner: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  offlineBannerText: { color: colors.primary, fontSize: 13, lineHeight: 18 },
});

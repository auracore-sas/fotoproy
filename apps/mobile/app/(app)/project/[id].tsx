import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Banner,
  CenterLoader,
  colors,
  elevations,
  ErrorState,
  fonts,
  radius,
  Screen,
  textStyles,
} from '../../../components/ui';
import { SyncBar } from '../../../components/sync-indicator';
import { api } from '../../../lib/api';
import { errorMessage, useAuth } from '../../../lib/auth';
import { getCachedProject, listLocalPhotos, upsertCachedProject } from '../../../lib/db';
import { useSync } from '../../../lib/sync';
import type { Project } from '../../../lib/types';

export default function ProjectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [mediaCount, setMediaCount] = useState(0);
  const { online } = useSync();
  const retryBusyRef = useRef(false);
  const loadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    if (!token || !id) {
      return;
    }
    if (!loadedOnceRef.current) {
      setLoading(true);
    }
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
      loadedOnceRef.current = true;
      setLoading(false);
    }
  }, [token, id]);

  // Silent refetch (no loader flicker): flips state only when the server answers.
  const refreshSilently = useCallback(async () => {
    if (!token || !id || retryBusyRef.current) {
      return;
    }
    retryBusyRef.current = true;
    try {
      const data = await api.getProject(token, id);
      setProject(data);
      void upsertCachedProject(data);
      setOffline(false);
    } catch {
      // Server still unreachable — keep showing the cached data + banner.
    } finally {
      retryBusyRef.current = false;
    }
  }, [token, id]);

  // While showing cached data with connectivity, retry periodically until the
  // server responds (a single retry can race the network coming back).
  useEffect(() => {
    if (!offline || !online) {
      return undefined;
    }
    void refreshSilently();
    const timer = setInterval(() => void refreshSilently(), 5_000);
    return () => clearInterval(timer);
  }, [offline, online, refreshSilently]);

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

  const canShare = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';

  if (loading) {
    return <CenterLoader />;
  }

  if (error || !project) {
    return (
      <Screen>
        <ErrorState
          title="No se pudo cargar el proyecto"
          message={error ?? 'El proyecto no está disponible en este dispositivo.'}
          onRetry={() => void load()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: project.code }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.bannerArea}>
          <SyncBar />
          {offline ? (
            <Banner
              tone="info"
              icon="📶"
              message={
                online
                  ? 'No se pudo conectar al servidor: mostrando datos guardados.'
                  : 'Sin conexión: mostrando datos guardados. Puedes seguir tomando fotos.'
              }
              actionLabel="Reintentar ahora"
              onAction={() => void refreshSilently()}
            />
          ) : null}
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroCode}>{project.code}</Text>
          <Text style={styles.heroName}>{project.name}</Text>
          <Text style={styles.heroClient}>{project.clientName ?? 'Sin cliente'}</Text>
          {project.description ? (
            <Text style={styles.heroDescription}>{project.description}</Text>
          ) : null}
        </View>

        {/* Primary action */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tomar foto o video"
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
          style={({ pressed }) => [styles.captureButton, pressed && styles.capturePressed]}
        >
          <View style={styles.captureIconWrap}>
            <Text style={styles.captureIcon}>📷</Text>
          </View>
          <View style={styles.captureTextWrap}>
            <Text style={styles.captureTitle}>Tomar foto / video</Text>
            <Text style={styles.captureSubtitle}>
              {mediaCount > 0
                ? `${mediaCount} ${mediaCount === 1 ? 'medio guardado' : 'medios guardados'} en este equipo`
                : 'Documenta el avance de la obra'}
            </Text>
          </View>
          <Text style={styles.captureChevron}>›</Text>
        </Pressable>

        {/* Secondary actions */}
        <View style={styles.grid}>
          <ActionTile
            glyph="🗺️"
            title="Planos"
            subtitle="Anclar fotos al plano"
            onPress={() =>
              router.push({ pathname: '/plans/[projectId]', params: { projectId: id } })
            }
          />
          <ActionTile
            glyph="🖼️"
            title="Galería"
            subtitle={
              mediaCount > 0
                ? `${mediaCount} ${mediaCount === 1 ? 'medio' : 'medios'}`
                : 'Local y del equipo'
            }
            onPress={() => router.push({ pathname: '/gallery', params: { projectId: id } })}
          />
        </View>

        {canShare ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Compartir avance"
            onPress={() =>
              router.push({ pathname: '/share/[projectId]', params: { projectId: id } })
            }
            style={({ pressed }) => [styles.rowTile, pressed && styles.tilePressed]}
          >
            <View style={styles.rowTileIcon}>
              <Text style={styles.rowTileGlyph}>🔗</Text>
            </View>
            <View style={styles.rowTileText}>
              <Text style={styles.rowTileTitle}>Compartir avance</Text>
              <Text style={styles.rowTileSubtitle}>
                Enlace de solo lectura para el cliente, con expiración
              </Text>
            </View>
            <Text style={styles.tileChevron}>›</Text>
          </Pressable>
        ) : null}

        {/* Details */}
        <Text style={styles.sectionLabel}>Detalles</Text>
        <View style={styles.infoCard}>
          <InfoRow label="Código" value={project.code} />
          <InfoRow label="Cliente" value={project.clientName ?? '—'} />
          <InfoRow label="Ubicación" value={location ?? '—'} />
          <InfoRow label="Creado" value={formatDate(project.createdAt)} last />
        </View>
      </ScrollView>
    </Screen>
  );
}

function ActionTile({
  glyph,
  title,
  subtitle,
  onPress,
}: {
  glyph: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <View style={styles.tileIcon}>
        <Text style={styles.tileGlyph}>{glyph}</Text>
      </View>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileSubtitle} numberOfLines={2}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('es-EC', { year: 'numeric', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  bannerArea: { marginBottom: 4 },

  hero: { marginTop: 4, marginBottom: 20 },
  heroCode: {
    ...textStyles.micro,
    color: colors.primary,
    marginBottom: 8,
  },
  heroName: { ...textStyles.display, fontSize: 26, lineHeight: 31 },
  heroClient: { ...textStyles.caption, marginTop: 6 },
  heroDescription: { ...textStyles.subtitle, marginTop: 10 },

  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: 18,
    ...elevations.floating,
  },
  capturePressed: { backgroundColor: colors.primaryPressed, transform: [{ scale: 0.99 }] },
  captureIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureIcon: { fontSize: 24 },
  captureTextWrap: { flex: 1 },
  captureTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: '#FFFFFF' },
  captureSubtitle: { fontFamily: fonts.sansMedium, fontSize: 12.5, color: '#D8E3FF', marginTop: 2 },
  captureChevron: { fontFamily: fonts.sansBold, fontSize: 22, color: '#D8E3FF' },

  grid: { flexDirection: 'row', gap: 12, marginTop: 12 },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    minHeight: 128,
    ...elevations.card,
  },
  tilePressed: { backgroundColor: colors.surfaceAlt, transform: [{ scale: 0.985 }] },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  tileGlyph: { fontSize: 20 },
  tileTitle: { ...textStyles.heading, fontSize: 16 },
  tileSubtitle: { ...textStyles.caption, fontSize: 12.5, marginTop: 2 },

  rowTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    ...elevations.card,
  },
  rowTileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTileGlyph: { fontSize: 19 },
  rowTileText: { flex: 1 },
  rowTileTitle: { ...textStyles.heading, fontSize: 16 },
  rowTileSubtitle: { ...textStyles.caption, fontSize: 12.5, marginTop: 2 },
  tileChevron: { fontFamily: fonts.sansBold, fontSize: 20, color: colors.textFaint },

  sectionLabel: { ...textStyles.micro, marginTop: 28, marginBottom: 10 },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
  },
  infoRow: { paddingVertical: 14 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  infoLabel: { ...textStyles.micro },
  infoValue: { ...textStyles.bodyStrong, marginTop: 3 },
});

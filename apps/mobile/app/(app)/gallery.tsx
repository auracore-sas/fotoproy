import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CenterLoader, colors, ErrorBanner, Screen } from '../../components/ui';
import { SyncBar } from '../../components/sync-indicator';
import { listLocalPins } from '../../lib/db';
import { listMergedGallery, refreshRemoteGallery } from '../../lib/remote-gallery';
import { useAuth } from '../../lib/auth';
import { useSync } from '../../lib/sync';
import { api } from '../../lib/api';
import type { ItemSyncState } from '../../lib/sync';
import type { Plan } from '../../lib/types';

type AuthorFilter = 'all' | 'mine' | 'team';

interface MediaRow {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  durationMs: number | null;
  localUri: string | null; // null for remote-only items
  capturedAt: string;
  syncedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  userId?: string | null;
  authorUserId?: string | null;
  /** F2.8: photo captured by another member (thumbnail cached locally). */
  isRemote?: boolean;
  thumbLocalUri?: string | null;
}

function formatDuration(ms: number | null): string {
  if (ms == null) {
    return '';
  }
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function Chip({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function GalleryScreen() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { token } = useAuth();
  const { online, items: queueItems } = useSync();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoThumbs, setVideoThumbs] = useState<Record<string, string>>({});
  const thumbCache = useRef<Record<string, string>>({});

  // Filters (F3.4): author · date · plan.
  const [author, setAuthor] = useState<AuthorFilter>('all');
  const [days, setDays] = useState(0); // 0 = any date
  const [planId, setPlanId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setLoading(true);
    try {
      const rows = await listMergedGallery(projectId);
      setItems(rows as unknown as MediaRow[]);
      setError(null);
    } catch {
      setError('No se pudieron cargar los medios guardados.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Reload on focus; also fetch the plan list once for the plan filter.
  useFocusEffect(
    useCallback(() => {
      void load();
      if (projectId && token && plans.length === 0) {
        api
          .listPlans(token, projectId)
          .then((page) => setPlans(page.items))
          .catch(() => undefined);
      }
    }, [load, projectId, token, plans.length]),
  );

  // While online, refresh the team gallery cache (metadata + thumbnails).
  useFocusEffect(
    useCallback(() => {
      if (!projectId || !token || !online) {
        return;
      }
      let mounted = true;
      refreshRemoteGallery(token, projectId)
        .catch(() => undefined)
        .finally(() => {
          if (mounted) {
            void load();
          }
        });
      return () => {
        mounted = false;
      };
    }, [projectId, token, online, load]),
  );

  // Fetch the pinned photo ids of the selected plan (local pending + synced).
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!planId) {
        setPinnedIds(new Set());
        return;
      }
      const local = await listLocalPins(planId).catch(() => []);
      const server = token ? await api.listPlanPins(token, planId).catch(() => []) : [];
      const ids = new Set<string>([
        ...local.map((p) => p.photoId),
        ...server.map((p) => p.photoId),
      ]);
      if (mounted) {
        setPinnedIds(ids);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [planId, token]);

  // Local video thumbnails (memory cache).
  useEffect(() => {
    let mounted = true;
    (async () => {
      const videos = items.filter((item) => item.kind === 'VIDEO' && !item.isRemote);
      const missing = videos.filter((v) => !thumbCache.current[v.id]);
      if (missing.length === 0) {
        return;
      }
      const results = await Promise.all(
        missing.map(async (video) => {
          try {
            if (!video.localUri) {
              return null;
            }
            const thumb = await getThumbnailAsync(video.localUri, { time: 0 });
            return { id: video.id, uri: thumb.uri } as const;
          } catch {
            return null;
          }
        }),
      );
      if (!mounted) {
        return;
      }
      const next = { ...thumbCache.current };
      for (const result of results) {
        if (result) {
          next[result.id] = result.uri;
        }
      }
      thumbCache.current = next;
      setVideoThumbs(next);
    })();
    return () => {
      mounted = false;
    };
  }, [items]);

  const visible = useMemo(() => {
    const since = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;
    return items.filter((row) => {
      // 'mine' = captures on this device; 'team' = others synced on the server.
      if (author === 'mine' && row.isRemote) {
        return false;
      }
      if (author === 'team' && !row.isRemote) {
        return false;
      }
      if (days > 0 && since && row.capturedAt < since) {
        return false;
      }
      if (planId && !pinnedIds.has(row.id)) {
        return false;
      }
      return true;
    });
  }, [items, author, days, planId, pinnedIds]);

  const openMedia = (item: MediaRow) => {
    if (!item.isRemote) {
      router.push({ pathname: '/media-viewer', params: { mediaId: item.id } });
      return;
    }
    router.push({ pathname: '/media-viewer', params: { remoteId: item.id } });
  };

  const tileThumb = (item: MediaRow): string | null => {
    if (item.isRemote) {
      return item.thumbLocalUri ?? null;
    }
    if (item.kind === 'VIDEO') {
      return videoThumbs[item.id] ?? null;
    }
    return item.localUri;
  };

  const renderItem = ({ item }: { item: MediaRow }) => {
    const isVideo = item.kind === 'VIDEO';
    const thumbUri = tileThumb(item);
    const queueState: ItemSyncState | undefined = item.isRemote ? undefined : queueItems[item.id];
    const badge =
      !item.isRemote && (queueState || item.syncedAt == null)
        ? (queueState ?? 'PENDING')
        : item.isRemote
          ? 'REMOTE'
          : null;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isVideo ? 'Abrir video' : 'Abrir foto'}
        onPress={() => openMedia(item)}
        style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
      >
        {thumbUri ? (
          <Image source={{ uri: thumbUri }} style={styles.tileImage} resizeMode="cover" />
        ) : (
          <View style={[styles.tileImage, styles.tilePlaceholder]}>
            <Text style={styles.videoGlyph}>{isVideo ? '▶' : '📷'}</Text>
          </View>
        )}
        {isVideo ? (
          <View style={styles.videoBadge} pointerEvents="none">
            <Text style={styles.videoIcon}>▶</Text>
            <Text style={styles.videoDuration}>{formatDuration(item.durationMs)}</Text>
          </View>
        ) : null}
        {badge === 'REMOTE' ? (
          <View
            pointerEvents="none"
            style={styles.syncBadge}
            accessibilityLabel="En línea (equipo)"
          >
            <Text style={styles.syncBadgeIcon}>☁</Text>
          </View>
        ) : badge ? (
          <View
            pointerEvents="none"
            accessibilityLabel={badge === 'FAILED' ? 'Error al sincronizar' : 'Por sincronizar'}
            style={[styles.syncBadge, badge === 'FAILED' && styles.syncBadgeError]}
          >
            {badge === 'UPLOADING' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.syncBadgeIcon}>{badge === 'FAILED' ? '⚠' : '⏫'}</Text>
            )}
          </View>
        ) : null}
      </Pressable>
    );
  };

  if (loading) {
    return <CenterLoader />;
  }

  return (
    <Screen>
      <ErrorBanner message={error} />
      <SyncBar />

      {/* Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <Chip label="Todas" active={author === 'all'} onPress={() => setAuthor('all')} />
        <Chip label="Mías" active={author === 'mine'} onPress={() => setAuthor('mine')} />
        <Chip label="Equipo" active={author === 'team'} onPress={() => setAuthor('team')} />
        <Chip
          label={
            days === 0
              ? '📅 Cualquier fecha'
              : days === 7
                ? '📅 Últimos 7 días'
                : '📅 Últimos 30 días'
          }
          active={days !== 0}
          onPress={() => setDays((d) => (d === 0 ? 7 : d === 7 ? 30 : 0))}
        />
        {planId ? (
          <Chip label="📌 Plano seleccionado ✕" active onPress={() => setPlanId(null)} />
        ) : null}
      </ScrollView>

      {plans.length > 0 && author !== 'team' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <Text style={styles.filterLabel}>Planos:</Text>
          {plans.map((plan) => (
            <Chip
              key={plan.id}
              label={plan.title}
              active={planId === plan.id}
              onPress={() => setPlanId((current) => (current === plan.id ? null : plan.id))}
            />
          ))}
        </ScrollView>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={3}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {items.length === 0 ? 'Sin medios guardados' : 'Sin resultados con estos filtros'}
            </Text>
            <Text style={styles.emptyText}>
              {items.length === 0
                ? 'Toma fotos o videos con la cámara y aparecerán aquí, incluso sin conexión. Los medios del equipo se muestran al abrir con internet.'
                : 'Prueba quitar algún filtro (autor, fecha o plano).'}
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterRow: { paddingHorizontal: 10, paddingVertical: 6, gap: 8, alignItems: 'center' },
  filterLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  chip: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  list: { padding: 4 },
  tile: {
    flex: 1 / 3,
    aspectRatio: 1,
    margin: 2,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  tileImage: { width: '100%', height: '100%' },
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#334155' },
  videoGlyph: { fontSize: 22, color: 'rgba(255,255,255,0.75)' },
  videoBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  videoIcon: { color: '#FFFFFF', fontSize: 11 },
  videoDuration: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  syncBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  syncBadgeIcon: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  syncBadgeError: { backgroundColor: '#DC2626' },
  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 28 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.text, textAlign: 'center' },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },
});

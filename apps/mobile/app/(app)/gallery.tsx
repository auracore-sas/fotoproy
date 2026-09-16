import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Banner, CenterLoader, colors, EmptyState, ErrorState, Screen } from '../../components/ui';
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

interface MediaTileProps {
  item: MediaRow;
  thumbUri: string | null;
  badge: ItemSyncState | 'REMOTE' | null;
  onOpen: (item: MediaRow) => void;
}

/**
 * Memoized square tile. Kept outside the screen so scrolling and filter
 * changes don't re-render (or re-decode) the whole grid (F4.3).
 */
const MediaTile = React.memo(function MediaTile({
  item,
  thumbUri,
  badge,
  onOpen,
}: MediaTileProps) {
  const isVideo = item.kind === 'VIDEO';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isVideo ? 'Abrir video' : 'Abrir foto'}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
    >
      {thumbUri ? (
        <Image
          source={thumbUri}
          style={styles.tileImage}
          contentFit="cover"
          transition={120}
          cachePolicy="memory-disk"
          recyclingKey={item.id}
        />
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
        <View pointerEvents="none" style={styles.syncBadge} accessibilityLabel="En línea (equipo)">
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
});

export default function GalleryScreen() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { token } = useAuth();
  const { online, items: queueItems } = useSync();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoThumbs, setVideoThumbs] = useState<Record<string, string>>({});
  const thumbCache = useRef<Record<string, string>>({});
  // Only the first load blocks; focus reloads keep the current grid visible.
  const loadedOnceRef = useRef(false);

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
    if (!loadedOnceRef.current) {
      setLoading(true);
    }
    try {
      const rows = await listMergedGallery(projectId);
      setItems(rows as unknown as MediaRow[]);
      setError(null);
    } catch {
      setError('No se pudieron cargar los medios guardados.');
    } finally {
      loadedOnceRef.current = true;
      setLoading(false);
    }
  }, [projectId]);

  /** Pull-to-refresh: local reload (+ team refresh when online). */
  const refreshAll = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setRefreshing(true);
    try {
      if (token && online) {
        await refreshRemoteGallery(token, projectId).catch(() => undefined);
      }
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [projectId, token, online, load]);

  const clearFilters = useCallback(() => {
    setAuthor('all');
    setDays(0);
    setPlanId(null);
  }, []);

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

  const openMedia = useCallback(
    (item: MediaRow) => {
      if (!item.isRemote) {
        router.push({ pathname: '/media-viewer', params: { mediaId: item.id } });
        return;
      }
      router.push({ pathname: '/media-viewer', params: { remoteId: item.id } });
    },
    [router],
  );

  const tileThumb = useCallback(
    (item: MediaRow): string | null => {
      if (item.isRemote) {
        return item.thumbLocalUri ?? null;
      }
      if (item.kind === 'VIDEO') {
        return videoThumbs[item.id] ?? null;
      }
      return item.localUri;
    },
    [videoThumbs],
  );

  const renderItem = useCallback(
    ({ item }: { item: MediaRow }) => {
      const queueState: ItemSyncState | undefined = item.isRemote
        ? undefined
        : queueItems[item.id];
      const badge: ItemSyncState | 'REMOTE' | null =
        !item.isRemote && (queueState || item.syncedAt == null)
          ? (queueState ?? 'PENDING')
          : item.isRemote
            ? 'REMOTE'
            : null;
      return (
        <MediaTile item={item} thumbUri={tileThumb(item)} badge={badge} onOpen={openMedia} />
      );
    },
    [queueItems, tileThumb, openMedia],
  );

  if (loading) {
    return <CenterLoader />;
  }

  if (error && items.length === 0) {
    return (
      <Screen>
        <ErrorState
          title="No se pudieron cargar los medios"
          message={error}
          onRetry={() => void load()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.bannerArea}>
        <SyncBar />
        {error ? (
          <Banner
            tone="error"
            message={error}
            actionLabel="Reintentar"
            onAction={() => void load()}
          />
        ) : null}
        {!online ? (
          <Banner
            tone="info"
            icon="✈️"
            message="Sin conexión · mostrando lo guardado en este equipo. Los medios del equipo vuelven al reconectar."
          />
        ) : null}
      </View>

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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} />
        }
        initialNumToRender={15}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews
        ListEmptyComponent={
          <EmptyState
            icon={items.length === 0 ? '📷' : '🔍'}
            title={items.length === 0 ? 'Sin medios guardados' : 'Sin resultados con estos filtros'}
            text={
              items.length === 0
                ? 'Toma fotos o videos con la cámara y aparecerán aquí, incluso sin conexión.'
                : 'Prueba quitar algún filtro de autor, fecha o plano.'
            }
            actionLabel={items.length === 0 ? 'Tomar foto' : 'Quitar filtros'}
            onAction={
              items.length === 0
                ? () => router.push({ pathname: '/capture', params: { projectId } })
                : clearFilters
            }
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bannerArea: { paddingHorizontal: 10 },
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
});

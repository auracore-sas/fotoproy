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
import {
  Banner,
  CenterLoader,
  colors,
  EmptyState,
  ErrorState,
  FilterChip,
  fonts,
  radius,
  Screen,
} from '../../components/ui';
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

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
const MediaTile = React.memo(function MediaTile({ item, thumbUri, badge, onOpen }: MediaTileProps) {
  const isVideo = item.kind === 'VIDEO';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isVideo ? 'Abrir video' : 'Abrir foto'}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
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

  const filtersActive = author !== 'all' || days !== 0 || planId !== null;

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
      const queueState: ItemSyncState | undefined = item.isRemote ? undefined : queueItems[item.id];
      const badge: ItemSyncState | 'REMOTE' | null =
        !item.isRemote && (queueState || item.syncedAt == null)
          ? (queueState ?? 'PENDING')
          : item.isRemote
            ? 'REMOTE'
            : null;
      return <MediaTile item={item} thumbUri={tileThumb(item)} badge={badge} onOpen={openMedia} />;
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
    <Screen edges={['bottom']}>
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
      <View style={styles.filtersWrap}>
        <Segmented
          value={author}
          onChange={setAuthor}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'mine', label: 'Mías' },
            { value: 'team', label: 'Equipo' },
          ]}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          <FilterChip
            label={days === 0 ? '📅 Cualquier fecha' : days === 7 ? '📅 7 días' : '📅 30 días'}
            active={days !== 0}
            onPress={() => setDays((d) => (d === 0 ? 7 : d === 7 ? 30 : 0))}
          />
          {plans.map((plan) => (
            <FilterChip
              key={plan.id}
              label={plan.title}
              active={planId === plan.id}
              onPress={() => setPlanId((current) => (current === plan.id ? null : plan.id))}
            />
          ))}
        </ScrollView>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {visible.length} {visible.length === 1 ? 'medio' : 'medios'}
            {filtersActive ? ` de ${items.length}` : ''}
          </Text>
          {filtersActive ? (
            <Pressable onPress={clearFilters} accessibilityRole="button" hitSlop={6}>
              <Text style={styles.clearText}>Quitar filtros</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={3}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshAll()}
            tintColor={colors.primary}
          />
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
  bannerArea: { paddingHorizontal: 12, paddingTop: 8 },

  filtersWrap: { paddingTop: 4 },
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    marginHorizontal: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 3,
    gap: 2,
  },
  segment: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.pill },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.textMuted },
  segmentTextActive: { color: colors.ink },

  chipRow: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2, gap: 8 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  summaryText: { fontFamily: fonts.sansSemiBold, fontSize: 12.5, color: colors.textMuted },
  clearText: { fontFamily: fonts.sansBold, fontSize: 12.5, color: colors.primary },

  list: { padding: 3, paddingTop: 8 },
  tile: {
    flex: 1 / 3,
    aspectRatio: 1,
    margin: 3,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  tileImage: { width: '100%', height: '100%' },
  tilePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  videoGlyph: { fontSize: 22, color: 'rgba(255,255,255,0.78)' },
  videoBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(10,16,32,0.72)',
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  videoIcon: { color: '#FFFFFF', fontSize: 9 },
  videoDuration: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontFamily: fonts.displayMedium,
    letterSpacing: 0.3,
  },
  syncBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(10,16,32,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  syncBadgeIcon: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  syncBadgeError: { backgroundColor: 'rgba(220,38,38,0.9)' },
});

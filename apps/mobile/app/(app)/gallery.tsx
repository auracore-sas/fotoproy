import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CenterLoader, colors, ErrorBanner, Screen } from '../../components/ui';
import { SyncBar } from '../../components/sync-indicator';
import { listLocalPhotos } from '../../lib/db';
import { useSync } from '../../lib/sync';
import type { ItemSyncState } from '../../lib/sync';

interface MediaRow {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  durationMs: number | null;
  localUri: string;
  capturedAt: string;
  syncedAt: string | null;
  latitude: number | null;
  longitude: number | null;
}

function formatDuration(ms: number | null): string {
  if (ms == null) {
    return '';
  }
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function GalleryScreen() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoThumbs, setVideoThumbs] = useState<Record<string, string>>({});
  const thumbCache = useRef<Record<string, string>>({});
  const sync = useSync();

  const load = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setLoading(true);
    try {
      const rows = await listLocalPhotos(projectId);
      setItems(rows as unknown as MediaRow[]);
    } catch {
      setError('No se pudieron cargar las fotos guardadas.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Reload when the screen regains focus (e.g. after taking new photos).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Generate thumbnails for videos (cached in memory).
  useEffect(() => {
    let mounted = true;
    (async () => {
      const videos = items.filter((item) => item.kind === 'VIDEO');
      const missing = videos.filter((v) => !thumbCache.current[v.id]);
      if (missing.length === 0) {
        return;
      }
      const results = await Promise.all(
        missing.map(async (video) => {
          try {
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

  const openMedia = (item: MediaRow) => {
    router.push({ pathname: '/media-viewer', params: { mediaId: item.id } });
  };

  const syncBadge = (item: MediaRow): { state: ItemSyncState | 'SYNCED'; label: string } => {
    const queueState = sync.items[item.id];
    if (queueState) {
      return {
        state: queueState,
        label: queueState === 'FAILED' ? '⚠' : queueState === 'UPLOADING' ? '…' : '⏫',
      };
    }
    return { state: 'SYNCED', label: '' };
  };

  const renderItem = ({ item }: { item: MediaRow }) => {
    const isVideo = item.kind === 'VIDEO';
    const thumbUri = isVideo ? videoThumbs[item.id] : item.localUri;
    const badge = syncBadge(item);
    const isSynced = badge.state === 'SYNCED' && item.syncedAt != null;
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
            {isVideo ? <ActivityIndicator color={colors.primary} /> : null}
          </View>
        )}
        {isVideo ? (
          <View style={styles.videoBadge} pointerEvents="none">
            <Text style={styles.videoIcon}>▶</Text>
            <Text style={styles.videoDuration}>{formatDuration(item.durationMs)}</Text>
          </View>
        ) : null}
        {!isSynced ? (
          <View
            pointerEvents="none"
            accessibilityLabel={
              badge.state === 'FAILED' ? 'Error al sincronizar' : 'Por sincronizar'
            }
            style={[styles.syncBadge, badge.state === 'FAILED' && styles.syncBadgeError]}
          >
            {badge.state === 'UPLOADING' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.syncBadgeIcon}>{badge.label}</Text>
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
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={3}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Sin fotos guardadas</Text>
            <Text style={styles.emptyText}>
              Toma fotos o videos con la cámara y aparecerán aquí, incluso sin conexión.
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center' },
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
  empty: { alignItems: 'center', paddingTop: 100, paddingHorizontal: 28 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  emptyText: { fontSize: 14, color: colors.textMuted, marginTop: 6, textAlign: 'center' },
});

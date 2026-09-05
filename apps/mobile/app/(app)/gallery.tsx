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
import { listMergedGallery, refreshRemoteGallery } from '../../lib/remote-gallery';
import { useAuth } from '../../lib/auth';
import { useSync } from '../../lib/sync';
import type { ItemSyncState } from '../../lib/sync';

interface MediaRow {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  durationMs: number | null;
  localUri: string | null; // null for remote-only items
  capturedAt: string;
  syncedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  /** F2.8: photo captured by another member (thumbnail cached locally). */
  isRemote?: boolean;
  /** Signed original URL for remote items (valid while the session is fresh). */
  imageUrl?: string | null;
  thumbLocalUri?: string | null;
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
  const { token } = useAuth();
  const { online, items: queueItems } = useSync();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoThumbs, setVideoThumbs] = useState<Record<string, string>>({});
  const thumbCache = useRef<Record<string, string>>({});

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

  // Reload when the screen regains focus (e.g. after taking new photos).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
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

  // Generate thumbnails for local videos (cached in memory).
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

  const openMedia = (item: MediaRow) => {
    if (!item.isRemote) {
      router.push({ pathname: '/media-viewer', params: { mediaId: item.id } });
      return;
    }
    // Remote item: the viewer fetches a fresh signed URL from the server
    // (cached ones expire), so this works whenever there is connectivity.
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
            {isVideo ? (
              <Text style={styles.videoGlyph}>▶</Text>
            ) : (
              <Text style={styles.videoGlyph}>📷</Text>
            )}
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
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={3}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Sin medios guardados</Text>
            <Text style={styles.emptyText}>
              Toma fotos o videos con la cámara y aparecerán aquí, incluso sin conexión. Los medios
              del equipo se muestran al abrir con internet.
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
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#334155' },
  videoGlyph: { color: 'rgba(255,255,255,0.75)', fontSize: 26 },
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

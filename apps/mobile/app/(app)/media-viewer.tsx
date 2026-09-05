import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CenterLoader, colors } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';
import { getLocalPhoto } from '../../lib/db';
import type { MediaKind } from '../../lib/types';

interface MediaRow {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  durationMs: number | null;
  /** Local file, or a remote URL when the item belongs to the team cache. */
  localUri: string;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  isRemote?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number | null): string {
  if (ms == null) {
    return '';
  }
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function VideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  useEffect(() => () => player.release(), [player]);
  return <VideoView player={player} style={styles.media} contentFit="contain" nativeControls />;
}

export default function MediaViewerScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { mediaId, remoteId } = useLocalSearchParams<{
    mediaId?: string;
    remoteId?: string;
  }>();
  const [row, setRow] = useState<MediaRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (mediaId) {
          const found = await getLocalPhoto(mediaId);
          if (mounted && found) {
            setRow(found as unknown as MediaRow);
          }
          return;
        }
        if (remoteId && token) {
          // Team photo: fetch a fresh signed URL from the server (needs network).
          const photo = await api.getPhoto(token, remoteId);
          if (mounted) {
            setRow({
              id: photo.id,
              kind: photo.kind as MediaKind,
              durationMs: photo.durationMs,
              localUri: photo.imageUrl,
              capturedAt: photo.capturedAt,
              latitude: photo.latitude,
              longitude: photo.longitude,
              notes: photo.notes,
              isRemote: true,
            });
          }
          return;
        }
      } catch (err) {
        if (mounted) {
          setError(errorMessage(err));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [mediaId, remoteId, token]);

  if (loading || !row) {
    return (
      <View style={styles.full}>
        {loading ? <CenterLoader /> : null}
        {!loading && !row ? (
          <Text style={styles.missing}>
            {error ?? 'Este medio ya no está disponible. Conéctate e inténtalo de nuevo.'}
          </Text>
        ) : null}
      </View>
    );
  }

  const isVideo = row.kind === 'VIDEO';
  const location =
    row.latitude != null && row.longitude != null
      ? `📍 ${Number(row.latitude).toFixed(6)}, ${Number(row.longitude).toFixed(6)}`
      : null;

  return (
    <View style={styles.container}>
      <View style={styles.mediaArea}>
        {isVideo ? (
          <VideoPlayer uri={row.localUri} />
        ) : (
          <Image source={{ uri: row.localUri }} style={styles.media} resizeMode="contain" />
        )}
      </View>

      {/* Close */}
      <Pressable
        onPress={() => router.back()}
        style={styles.closeButton}
        accessibilityRole="button"
        accessibilityLabel="Cerrar"
      >
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.kind}>
          {isVideo ? '🎥 Video' : '📷 Foto'}
          {isVideo && row.durationMs != null ? ` · ${formatDuration(row.durationMs)}` : ''}
        </Text>
        <Text style={styles.date}>{formatDate(row.capturedAt)}</Text>
        {row.isRemote ? <Text style={styles.remote}>☁ Medio del equipo (en línea)</Text> : null}
        {location ? <Text style={styles.location}>{location}</Text> : null}
        {row.notes ? <Text style={styles.notes}>{row.notes}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  missing: { color: colors.textMuted, fontSize: 15, textAlign: 'center', marginHorizontal: 24 },
  container: { flex: 1, backgroundColor: '#000' },
  mediaArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  media: { width: '100%', height: '100%' },
  closeButton: {
    position: 'absolute',
    top: 56,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  info: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 30,
  },
  kind: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  date: { color: '#E2E8F0', fontSize: 14, marginTop: 4 },
  remote: { color: '#93C5FD', fontSize: 13, marginTop: 4, fontStyle: 'italic' },
  location: { color: '#93C5FD', fontSize: 13, marginTop: 4 },
  notes: { color: '#E2E8F0', fontSize: 14, marginTop: 6 },
});

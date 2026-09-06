import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CenterLoader, colors, ErrorBanner, Screen } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';
import type { Pin } from '../../lib/types';

function formatDuration(ms: number | null): string {
  if (ms == null) {
    return '';
  }
  const total = Math.round(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * F3.4 — grid of the photos anchored on a plan (every synced pin), each tile
 * opens the media viewer (fresh signed URL from the server).
 */
export default function PlanPhotosScreen() {
  const router = useRouter();
  const { planId, planTitle } = useLocalSearchParams<{ planId: string; planTitle?: string }>();
  const { token } = useAuth();
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !planId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listPlanPins(token, planId);
      setPins(rows);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [token, planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const renderItem = ({ item }: { item: Pin }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Abrir foto anclada"
      onPress={() => router.push({ pathname: '/media-viewer', params: { remoteId: item.photoId } })}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
    >
      {item.photo?.thumbnailUrl ? (
        <Image
          source={{ uri: item.photo.thumbnailUrl }}
          style={styles.tileImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.tileImage, styles.tilePlaceholder]}>
          <Text style={styles.glyph}>{item.photo?.kind === 'VIDEO' ? '▶' : '📷'}</Text>
        </View>
      )}
      {item.photo?.kind === 'VIDEO' && item.photo.durationMs != null ? (
        <View style={styles.duration} pointerEvents="none">
          <Text style={styles.durationText}>{formatDuration(item.photo.durationMs)}</Text>
        </View>
      ) : null}
      <View style={styles.coords} pointerEvents="none">
        <Text style={styles.coordsText}>
          📍 {item.xPercentage.toFixed(1)}%, {item.yPercentage.toFixed(1)}%
        </Text>
      </View>
    </Pressable>
  );

  if (loading) {
    return <CenterLoader />;
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: planTitle ? `Fotos · ${planTitle}` : 'Fotos del plano' }} />
      <ErrorBanner message={error} />
      <FlatList
        data={pins}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={3}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Este plano aún no tiene fotos ancladas</Text>
            <Text style={styles.emptyText}>
              Abre el plano, toca un punto y elige o toma una foto para anclarla aquí.
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
  glyph: { fontSize: 24, color: 'rgba(255,255,255,0.75)' },
  duration: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  durationText: { color: '#FFFFFF', fontSize: 10, fontWeight: '600' },
  coords: {
    position: 'absolute',
    left: 4,
    top: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  coordsText: { color: '#FDE68A', fontSize: 9, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 28 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text, textAlign: 'center' },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },
});

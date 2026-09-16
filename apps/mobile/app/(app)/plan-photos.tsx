import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { CenterLoader, colors, EmptyState, ErrorState, Screen } from '../../components/ui';
import { SyncBar } from '../../components/sync-indicator';
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

  const renderItem = useCallback(
    ({ item }: { item: Pin }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir foto anclada"
        onPress={() =>
          router.push({ pathname: '/media-viewer', params: { remoteId: item.photoId } })
        }
        style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
      >
        {item.photo?.thumbnailUrl ? (
          <Image
            source={item.photo.thumbnailUrl}
            style={styles.tileImage}
            contentFit="cover"
            transition={120}
            cachePolicy="memory-disk"
            recyclingKey={item.id}
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
    ),
    [router],
  );

  if (loading) {
    return <CenterLoader />;
  }

  if (error) {
    return (
      <Screen>
        <Stack.Screen options={{ title: planTitle ? `Fotos · ${planTitle}` : 'Fotos del plano' }} />
        <ErrorState
          title="No se pudieron cargar las fotos del plano"
          message={error}
          onRetry={() => void load()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: planTitle ? `Fotos · ${planTitle}` : 'Fotos del plano' }} />
      <View style={styles.bannerArea}>
        <SyncBar />
      </View>
      <FlatList
        data={pins}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={3}
        contentContainerStyle={styles.list}
        initialNumToRender={15}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews
        ListEmptyComponent={
          <EmptyState
            icon="📌"
            title="Este plano aún no tiene fotos ancladas"
            text="Abre el plano, toca un punto y elige o toma una foto para anclarla aquí."
            actionLabel="Volver al plano"
            onAction={() => router.back()}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bannerArea: { paddingHorizontal: 10, paddingTop: 6 },
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
});

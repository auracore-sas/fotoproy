import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { CenterLoader, colors, EmptyState, ErrorState, fonts, Screen } from '../../components/ui';
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
        style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
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
            {item.xPercentage.toFixed(1)}% · {item.yPercentage.toFixed(1)}%
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
    <Screen edges={['bottom']}>
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
  bannerArea: { paddingHorizontal: 12, paddingTop: 8 },
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
  tilePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  glyph: { fontSize: 24, color: 'rgba(255,255,255,0.78)' },
  duration: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    backgroundColor: 'rgba(10,16,32,0.72)',
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontFamily: fonts.displayMedium,
    letterSpacing: 0.3,
  },
  coords: {
    position: 'absolute',
    left: 5,
    top: 5,
    backgroundColor: 'rgba(10,16,32,0.72)',
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  coordsText: { color: colors.accent, fontSize: 9.5, fontFamily: fonts.displayMedium },
});

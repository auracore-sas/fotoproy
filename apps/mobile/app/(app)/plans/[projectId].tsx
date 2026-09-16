import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Banner, Button, CenterLoader, colors, EmptyState, ErrorState, Screen } from '../../../components/ui';
import { SyncBar } from '../../../components/sync-indicator';
import { api } from '../../../lib/api';
import { errorMessage, useAuth } from '../../../lib/auth';
import { generateId } from '../../../lib/id';
import type { Plan, UserRole } from '../../../lib/types';

function canUpload(role: UserRole | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPERVISOR';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-EC', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function PlansScreen() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { token, user } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null); // 0..1
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Only the first load blocks; focus reloads keep the current list visible.
  const loadedOnceRef = useRef(false);

  const load = useCallback(
    async (asRefresh = false) => {
      if (!token || !projectId) {
        return;
      }
      if (asRefresh) {
        setRefreshing(true);
      } else if (!loadedOnceRef.current) {
        setLoading(true);
      }
      setError(null);
      try {
        const page = await api.listPlans(token, projectId);
        setPlans(page.items);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        loadedOnceRef.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, projectId],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Picks an image and uploads it as a new plan (with progress). */
  const pickAndUpload = async () => {
    if (!token || !projectId) {
      return;
    }
    setUploadError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permiso de galería',
        permission.canAskAgain
          ? 'Activa el permiso de fotos para elegir el plano.'
          : 'El permiso de fotos está bloqueado en este dispositivo. Actívalo desde los ajustes.',
        permission.canAskAgain
          ? [{ text: 'Entendido' }]
          : [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
            ],
      );
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (picked.canceled || picked.assets.length === 0) {
      return;
    }
    const asset = picked.assets[0];
    const ext = asset.fileName?.split('.').pop()?.toLowerCase();
    const contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

    try {
      setUploadProgress(0);
      const id = generateId();
      const presign = await api.presignPlanUpload(token, {
        id,
        projectId,
        contentType,
      });
      await uploadWithProgress(asset.uri, presign.uploadUrl, contentType);
      setUploadProgress(1);
      const plan = await api.createPlan(token, {
        id,
        projectId,
        title: title.trim() || `Plano ${new Date().toLocaleDateString('es-EC')}`,
        planKind: 'IMAGE',
        pageCount: 1,
        storageKey: presign.storageKey,
      });
      setUploadOpen(false);
      setTitle('');
      setUploadProgress(null);
      setPlans((current) => [plan, ...current]);
    } catch (err) {
      setUploadProgress(null);
      setUploadError(errorMessage(err));
    }
  };

  const uploadWithProgress = (
    uri: string,
    url: string,
    contentType: string,
  ): Promise<FileSystem.FileSystemUploadResult | null> =>
    new Promise((resolve, reject) => {
      const task = FileSystem.createUploadTask(
        url,
        uri,
        {
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: { 'Content-Type': contentType },
        },
        ({ totalBytesSent, totalBytesExpectedToSend }) => {
          if (totalBytesExpectedToSend > 0) {
            setUploadProgress(totalBytesSent / totalBytesExpectedToSend);
          }
        },
      );
      task
        .uploadAsync()
        .then((result) => resolve(result ?? null))
        .catch(reject);
    });

  const renderItem = useCallback(
    ({ item }: { item: Plan }) => (
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          router.push({ pathname: '/plan-viewer', params: { planId: item.id } })
        }
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      >
        {item.thumbnailUrl ? (
          <Image
            source={item.thumbnailUrl}
            style={styles.thumb}
            contentFit="cover"
            transition={120}
            cachePolicy="memory-disk"
            recyclingKey={item.id}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Text style={styles.thumbGlyph}>{item.planKind === 'PDF' ? '📄' : '🗺️'}</Text>
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.meta}>
            {formatDate(item.createdAt)}
            {item.pageCount > 1 ? ` · ${item.pageCount} páginas` : ''}
            {item.planKind === 'PDF' ? ' · PDF' : ''}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    ),
    [router],
  );

  if (loading) {
    return <CenterLoader />;
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Planos',
          headerRight: canUpload(user?.role)
            ? () => (
                <Pressable onPress={() => setUploadOpen(true)} accessibilityRole="button">
                  <Text style={styles.uploadHeader}>＋ Subir</Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <View style={styles.bannerArea}>
        <SyncBar />
        {error && plans.length > 0 ? (
          <Banner
            tone="error"
            message={error}
            actionLabel="Reintentar"
            onAction={() => void load()}
          />
        ) : null}
      </View>
      {error && plans.length === 0 ? (
        <ErrorState
          title="No se pudieron cargar los planos"
          message={error}
          onRetry={() => void load()}
        />
      ) : (
        <FlatList
          data={plans}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          ListEmptyComponent={
            <EmptyState
              icon="🗺️"
              title="Sin planos todavía"
              text={
                canUpload(user?.role)
                  ? 'Sube el plano o mapa de la obra para anclar fotos sobre él.'
                  : 'Pide a un administrador o supervisor que suba el plano de la obra.'
              }
              actionLabel={canUpload(user?.role) ? 'Subir plano' : undefined}
              onAction={canUpload(user?.role) ? () => setUploadOpen(true) : undefined}
            />
          }
        />
      )}

      {/* Upload sheet */}
      <Modal
        visible={uploadOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setUploadOpen(false)}
      >
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Subir plano</Text>
            <Text style={styles.sheetHint}>
              Elige una imagen del plano o mapa. Se guarda en el proyecto y podrás anclar fotos
              sobre ella.
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Título del plano (ej.: Plano estructural – Piso 1)"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={255}
            />
            {uploadProgress !== null ? (
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${Math.round(uploadProgress * 100)}%` }]}
                />
              </View>
            ) : null}
            {uploadError ? <Text style={styles.uploadError}>{uploadError}</Text> : null}
            <Button
              title={uploadProgress !== null ? 'Subiendo…' : 'Elegir imagen y subir'}
              onPress={() => void pickAndUpload()}
              loading={uploadProgress !== null}
            />
            <Pressable
              onPress={() => setUploadOpen(false)}
              style={styles.cancel}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bannerArea: { paddingHorizontal: 16, paddingTop: 8 },
  list: { padding: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginBottom: 10,
  },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.border },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 26 },
  cardBody: { flex: 1, marginHorizontal: 12 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  chevron: { fontSize: 24, color: colors.textMuted },
  uploadHeader: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 34,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  sheetHint: { fontSize: 13, color: colors.textMuted, marginTop: 6, lineHeight: 19 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    marginTop: 14,
    marginBottom: 14,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: { height: '100%', backgroundColor: colors.primary },
  uploadError: { color: colors.danger, fontSize: 13, marginBottom: 10 },
  cancel: { alignItems: 'center', marginTop: 14 },
  cancelText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});

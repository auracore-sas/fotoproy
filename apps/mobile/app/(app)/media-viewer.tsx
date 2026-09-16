import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
// NOTE: use the legacy subpath on purpose — `expo-media-library` (modern)
// requires the 'ExpoMediaLibraryNext' native module that Expo Go 57.0.19 does
// not ship yet; the legacy API targets the bundled 'ExpoMediaLibrary' module
// and exposes the same saveToLibraryAsync / requestPermissionsAsync helpers.
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { CenterLoader, colors, ErrorState } from '../../components/ui';
import CommentsSheet from '../../components/comments-sheet';
import { api } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';
import { getCachedProject, getLocalPhoto, updateLocalPhotoNotes } from '../../lib/db';
import { useSync } from '../../lib/sync';
import type { MediaKind } from '../../lib/types';

interface MediaRow {
  id: string;
  projectId: string;
  userId: string | null;
  kind: 'PHOTO' | 'VIDEO';
  durationMs: number | null;
  localUri: string;
  capturedAt: string;
  syncedAt: string | null;
  createdAt: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
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
  const { mediaId, remoteId } = useLocalSearchParams<{ mediaId?: string; remoteId?: string }>();
  const sync = useSync();
  const [row, setRow] = useState<MediaRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectLabel, setProjectLabel] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [exporting, setExporting] = useState<'gallery' | 'share' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let found: MediaRow | null = null;
      if (mediaId) {
        found = (await getLocalPhoto(mediaId)) as unknown as MediaRow | null;
      } else if (remoteId && token) {
        // Team photo: fetch a fresh signed URL from the server (needs network).
        const photo = await api.getPhoto(token, remoteId);
        found = {
          id: photo.id,
          projectId: photo.projectId,
          userId: photo.userId,
          kind: photo.kind as MediaKind,
          durationMs: photo.durationMs,
          localUri: photo.imageUrl,
          capturedAt: photo.capturedAt,
          syncedAt: photo.syncedAt,
          createdAt: photo.syncedAt,
          latitude: photo.latitude,
          longitude: photo.longitude,
          altitude: photo.altitude,
          notes: photo.notes,
          isRemote: true,
        };
      }
      if (found) {
        setRow(found);
        const cached = await getCachedProject(found.projectId).catch(() => null);
        setProjectLabel(cached ? `${cached.code} · ${cached.name}` : found.projectId);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [mediaId, remoteId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const isVideo = row?.kind === 'VIDEO';
  const location =
    row && row.latitude != null && row.longitude != null
      ? `${Number(row.latitude).toFixed(6)}, ${Number(row.longitude).toFixed(6)}${
          row.altitude != null ? ` · ${Math.round(row.altitude)} m` : ''
        }`
      : null;

  // Editing the note is only allowed while the photo is still pending upload.
  const canEditNote = !!row && !row.isRemote && row.syncedAt == null;
  const queueStatus = row ? sync.items[row.id] : undefined;
  const syncLabel =
    !row || row.isRemote
      ? row?.isRemote
        ? 'En línea (equipo)'
        : ''
      : row.syncedAt
        ? `Sincronizado ${formatDate(row.syncedAt)}`
        : queueStatus === 'UPLOADING'
          ? 'Subiendo…'
          : queueStatus === 'FAILED'
            ? 'Error al sincronizar — reintenta desde la galería'
            : 'Por subir (pendiente)';

  const metaRows = useMemo(() => {
    if (!row) {
      return [];
    }
    return [
      { label: 'Medio', value: isVideo ? 'Video' : 'Foto' },
      ...(row.durationMs != null
        ? [{ label: 'Duración', value: formatDuration(row.durationMs) }]
        : []),
      { label: 'Proyecto', value: projectLabel ?? row.projectId },
      {
        label: 'Capturada (reloj dispositivo)',
        value: `${formatDate(row.capturedAt)}\n${row.capturedAt}`,
      },
      { label: 'Sincronización', value: syncLabel },
      { label: 'GPS', value: location ?? 'Sin coordenadas' },
      ...(row.userId ? [{ label: 'Autor (id)', value: row.userId }] : []),
      { label: 'Identificador (UUID)', value: row.id },
      ...(!row.isRemote
        ? [
            {
              label: 'Archivo local',
              value: row.localUri ?? '',
            },
            {
              label: 'Creado en BD local',
              value: `${formatDate(row.createdAt)}\n${row.createdAt}`,
            },
          ]
        : []),
    ].filter((r) => r.value !== '');
  }, [row, isVideo, projectLabel, syncLabel, location]);

  if (loading || !row) {
    return (
      <View style={styles.full}>
        {loading ? (
          <CenterLoader />
        ) : (
          <ErrorState
            title={error ? 'No se pudo abrir el medio' : 'Medio no disponible'}
            message={
              error ??
              'Este medio ya no está disponible. Revisa tu conexión e inténtalo de nuevo.'
            }
            onRetry={() => void load()}
          />
        )}
      </View>
    );
  }

  const saveNote = async () => {
    if (!row) {
      return;
    }
    const next = draftNote.trim() === '' ? null : draftNote.trim();
    setEditingNote(false);
    setRow({ ...row, notes: next });
    try {
      await updateLocalPhotoNotes(row.id, next);
    } catch {
      // Non-fatal; the row was already updated in memory.
    }
  };

  /**
   * Returns a file ready to export: the server copy (stamped original) when
   * the media is synced or remote, or the local file when still pending.
   */
  const exportFile = async (): Promise<{ uri: string; mimeType: string }> => {
    if (!row) {
      throw new Error('Medio no disponible.');
    }
    const kind = row.kind === 'VIDEO' ? 'VIDEO' : 'PHOTO';
    const ext = kind === 'VIDEO' ? 'mp4' : 'jpg';
    const mimeType = kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg';
    if (!row.isRemote && row.syncedAt == null) {
      // Still pending: only the local file exists (no stamp yet).
      return { uri: row.localUri, mimeType };
    }
    // Synced / remote: fetch a fresh signed URL and download the server copy
    // (includes the burned evidence stamp for photos).
    if (!token) {
      throw new Error('Necesitas sesión para descargar el original.');
    }
    const dir = `${FileSystem.cacheDirectory ?? ''}export/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
    const target = `${dir}${row.id}.${ext}`;
    const fresh = await api.getPhoto(token, row.id);
    const result = await FileSystem.downloadAsync(fresh.imageUrl, target);
    if (result.status < 200 || result.status >= 300) {
      throw new Error('No se pudo descargar el original del servidor.');
    }
    return { uri: target, mimeType };
  };

  const saveToGallery = async () => {
    if (exporting || !row) {
      return;
    }
    setExporting('gallery');
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert(
          'Permiso de galería',
          'Activa el permiso de fotos para guardar el archivo en tu galería.',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Abrir ajustes', onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }
      const { uri } = await exportFile();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert(
        '✓ Guardado',
        row.isRemote || row.syncedAt
          ? 'Guardado en tu galería (original con estampa).'
          : 'Guardado en tu galería (copia local, aún sin sincronizar).',
      );
    } catch (err) {
      Alert.alert('Error al guardar', errorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  const shareFile = async () => {
    if (exporting || !row) {
      return;
    }
    setExporting('share');
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Compartir no disponible', 'Este dispositivo no soporta compartir archivos.');
        return;
      }
      const { uri, mimeType } = await exportFile();
      await Sharing.shareAsync(uri, {
        mimeType,
        dialogTitle: row.kind === 'VIDEO' ? 'Compartir video' : 'Compartir foto',
      });
    } catch (err) {
      Alert.alert('Error al compartir', errorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.mediaArea}>
        {isVideo ? (
          <VideoPlayer uri={row.localUri} />
        ) : (
          <Image
            source={row.localUri}
            style={styles.media}
            contentFit="contain"
            transition={120}
            cachePolicy="memory-disk"
          />
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
        {row.isRemote ? (
          <Text style={styles.remote}>☁ Medio del equipo (en línea)</Text>
        ) : (
          <Text style={[styles.sync, row.syncedAt == null && styles.syncPending]}>{syncLabel}</Text>
        )}
        {location ? <Text style={styles.location}>📍 {location}</Text> : null}

        {editingNote ? (
          <View style={styles.noteEditor}>
            <TextInput
              value={draftNote}
              onChangeText={setDraftNote}
              placeholder="Nota breve de la foto (opcional)…"
              placeholderTextColor={colors.textMuted}
              style={styles.noteInput}
              maxLength={2000}
              multiline
              autoFocus
            />
            <View style={styles.noteActions}>
              <Pressable
                onPress={() => setEditingNote(false)}
                style={styles.noteAction}
                accessibilityRole="button"
              >
                <Text style={styles.noteActionCancel}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveNote()}
                style={styles.noteAction}
                accessibilityRole="button"
              >
                <Text style={styles.noteActionSave}>Guardar nota</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.metaButtonsRow}>
            <Pressable
              onPress={() => setShowMeta(true)}
              style={styles.metaButton}
              accessibilityRole="button"
              accessibilityLabel="Ver metadatos"
            >
              <Text style={styles.metaButtonText}>ℹ️ Ver metadatos</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowComments(true)}
              style={styles.metaButton}
              accessibilityRole="button"
              accessibilityLabel="Comentarios"
            >
              <Text style={styles.metaButtonText}>💬 Comentarios</Text>
            </Pressable>
          </View>
        )}

        {showComments ? (
          <CommentsSheet
            visible={showComments}
            photoId={row.id}
            onClose={() => setShowComments(false)}
          />
        ) : null}

        <View style={styles.exportRow}>
          <Pressable
            onPress={() => void saveToGallery()}
            disabled={exporting !== null}
            style={({ pressed }) => [styles.exportButton, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
          >
            <Text style={styles.exportText}>
              {exporting === 'gallery' ? 'Guardando…' : '💾 Guardar en galería'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void shareFile()}
            disabled={exporting !== null}
            style={({ pressed }) => [styles.exportButton, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
          >
            <Text style={styles.exportText}>
              {exporting === 'share' ? 'Preparando…' : '↗️ Compartir'}
            </Text>
          </Pressable>
        </View>
        {row && !row.isRemote && row.syncedAt == null ? (
          <Text style={styles.exportHint}>
            Pendiente de sincronizar: se exporta la copia local (sin estampa).
          </Text>
        ) : null}

        {row.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notes}>{row.notes}</Text>
            {canEditNote ? (
              <Pressable
                onPress={() => {
                  setDraftNote(row.notes ?? '');
                  setEditingNote(true);
                }}
                style={styles.editNoteLink}
                accessibilityRole="button"
              >
                <Text style={styles.editNoteText}>✏️ Editar nota</Text>
              </Pressable>
            ) : null}
          </View>
        ) : canEditNote ? (
          <Pressable
            onPress={() => {
              setDraftNote('');
              setEditingNote(true);
            }}
            style={styles.editNoteLink}
            accessibilityRole="button"
          >
            <Text style={styles.editNoteText}>✏️ Agregar nota (se sincroniza al subir)</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Metadata sheet */}
      <Modal
        visible={showMeta}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMeta(false)}
      >
        <View style={styles.metaOverlay}>
          <View style={styles.metaSheet}>
            <Text style={styles.metaTitle}>Metadatos del medio</Text>
            <ScrollView style={styles.metaScroll}>
              {metaRows.map((r) => (
                <View key={r.label} style={styles.metaRow}>
                  <Text style={styles.metaLabel}>{r.label}</Text>
                  <Text style={styles.metaValue} selectable>
                    {r.value}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => setShowMeta(false)}
              style={styles.metaClose}
              accessibilityRole="button"
            >
              <Text style={styles.metaCloseText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
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
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 30,
  },
  kind: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  date: { color: '#E2E8F0', fontSize: 14, marginTop: 4 },
  remote: { color: '#93C5FD', fontSize: 13, marginTop: 4, fontStyle: 'italic' },
  sync: { color: '#6EE7B7', fontSize: 13, marginTop: 4, fontWeight: '600' },
  syncPending: { color: '#FBBF24' },
  location: { color: '#93C5FD', fontSize: 13, marginTop: 4 },
  metaButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  metaButtonText: { color: '#DBEAFE', fontSize: 13, fontWeight: '600' },
  metaButtonsRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  exportRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  exportButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  exportText: { color: '#DBEAFE', fontSize: 13, fontWeight: '600' },
  exportHint: { color: '#94A3B8', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  notesBox: {
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 10,
  },
  notes: { color: '#E2E8F0', fontSize: 14, lineHeight: 20 },
  editNoteLink: { marginTop: 8 },
  editNoteText: { color: '#93C5FD', fontSize: 13, fontWeight: '600' },
  noteEditor: { marginTop: 10 },
  noteInput: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    color: '#FFFFFF',
    padding: 10,
    minHeight: 64,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  noteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 8 },
  noteAction: { paddingVertical: 4, paddingHorizontal: 6 },
  noteActionCancel: { color: '#CBD5E1', fontSize: 14 },
  noteActionSave: { color: '#93C5FD', fontSize: 14, fontWeight: '700' },
  metaOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  metaSheet: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 30,
    maxHeight: '75%',
  },
  metaTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 12 },
  metaScroll: { flexGrow: 0 },
  metaRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 10,
  },
  metaLabel: { color: '#94A3B8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  metaValue: { color: '#E2E8F0', fontSize: 13, marginTop: 3, lineHeight: 18 },
  metaClose: {
    marginTop: 14,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  metaCloseText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});

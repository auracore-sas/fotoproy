import { useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CenterLoader, colors } from '../../components/ui';
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
  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
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
        if (mounted && found) {
          setRow(found);
          const cached = await getCachedProject(found.projectId).catch(() => null);
          if (mounted && cached) {
            setProjectLabel(`${cached.code} · ${cached.name}`);
          } else if (mounted) {
            setProjectLabel(found.projectId);
          }
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
        {loading ? <CenterLoader /> : null}
        {!loading && !row ? (
          <Text style={styles.missing}>
            {error ?? 'Este medio ya no está disponible. Conéctate e inténtalo de nuevo.'}
          </Text>
        ) : null}
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
          <Pressable
            onPress={() => setShowMeta(true)}
            style={styles.metaButton}
            accessibilityRole="button"
            accessibilityLabel="Ver metadatos"
          >
            <Text style={styles.metaButtonText}>ℹ️ Ver metadatos</Text>
          </Pressable>
        )}

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

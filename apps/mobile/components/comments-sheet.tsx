/**
 * Comments sheet (F3.5): view + add comments on a photo.
 *
 * Works offline: new comments are stored locally (append-only) and enqueued
 * in the sync queue; when connectivity returns the engine POSTs them. Server
 * comments are merged with the local pending ones (dedupe by client id).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from './ui';
import { api } from '../lib/api';
import { errorMessage, useAuth } from '../lib/auth';
import { createLocalComment, enqueueSync, listLocalComments, markCommentSynced } from '../lib/db';
import { generateId } from '../lib/id';
import { useSync } from '../lib/sync';
import type { Comment } from '../lib/types';

interface DisplayComment extends Comment {
  pending?: boolean;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const minutes = Math.round((now - date.getTime()) / 60000);
  if (minutes < 1) {
    return 'ahora';
  }
  if (minutes < 60) {
    return `hace ${minutes} min`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `hace ${hours} h`;
  }
  return date.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CommentsSheet({
  visible,
  photoId,
  onClose,
}: {
  visible: boolean;
  photoId: string;
  onClose: () => void;
}) {
  const { token, user } = useAuth();
  const { online } = useSync();
  const [comments, setComments] = useState<DisplayComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!photoId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [server, local] = await Promise.all([
        token ? api.listPhotoComments(token, photoId).catch(() => [] as Comment[]) : [],
        listLocalComments(photoId).catch(() => []),
      ]);
      const pending = local.filter((c) => c.syncedAt == null);
      const serverIds = new Set(server.map((c) => c.id));
      const merged: DisplayComment[] = [
        ...pending
          .filter((c) => !serverIds.has(c.id))
          .map((c) => ({
            id: c.id,
            photoId: c.photoId,
            userId: user?.id ?? null,
            authorName: user?.fullName ?? 'Tú',
            body: c.body,
            createdAt: c.createdAt,
            pending: true,
          })),
        ...server,
      ];
      merged.sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0));
      setComments(merged);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [photoId, token, user]);

  useEffect(() => {
    if (visible) {
      void load();
    }
  }, [visible, load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) {
      return;
    }
    setSending(true);
    setError(null);
    const id = generateId();
    try {
      await createLocalComment({ id, photoId, body });
      await enqueueSync('comment', id, { photoId, body });
      if (token && online) {
        try {
          await api.createComment(token, { id, photoId, body });
          await markCommentSynced(id, new Date().toISOString());
        } catch {
          // The sync queue uploads it when connectivity returns.
        }
      }
      setDraft('');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          <Text style={styles.title}>💬 Comentarios</Text>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {loading ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              style={styles.list}
              contentContainerStyle={comments.length === 0 ? styles.emptyWrap : undefined}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  Sin comentarios todavía. Escribe el primero (puede ser sin conexión).
                </Text>
              }
              renderItem={({ item }) => (
                <View style={[styles.comment, item.pending && styles.commentPending]}>
                  <View style={styles.commentHead}>
                    <Text style={styles.author}>{item.authorName ?? 'Anónimo'}</Text>
                    <Text style={styles.when}>{formatWhen(item.createdAt)}</Text>
                    {item.pending ? <Text style={styles.pendingBadge}>⏫ por subir</Text> : null}
                  </View>
                  <Text style={styles.body}>{item.body}</Text>
                </View>
              )}
            />
          )}

          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Escribe un comentario…"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              multiline
              maxLength={2000}
            />
            <Pressable
              onPress={() => void send()}
              disabled={sending || draft.trim().length === 0}
              style={[styles.send, (sending || draft.trim().length === 0) && styles.sendDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Enviar comentario"
            >
              <Text style={styles.sendText}>{sending ? '…' : 'Enviar'}</Text>
            </Pressable>
          </View>

          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button">
            <Text style={styles.closeText}>Cerrar</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    height: '78%',
  },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 10 },
  errorText: { color: colors.danger, fontSize: 13, marginBottom: 8 },
  loader: { marginTop: 30 },
  list: { flex: 1 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 20,
  },
  comment: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  commentPending: { borderStyle: 'dashed', opacity: 0.9 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  when: { color: colors.textMuted, fontSize: 11 },
  pendingBadge: { color: '#B45309', fontSize: 11, fontWeight: '700' },
  body: { color: colors.text, fontSize: 14, marginTop: 4, lineHeight: 20 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
    maxHeight: 110,
    textAlignVertical: 'top',
  },
  send: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: '#FFFFFF', fontWeight: '700' },
  close: { alignItems: 'center', marginTop: 12 },
  closeText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});

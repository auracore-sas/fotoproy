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
import { colors, fonts, radius, textStyles } from './ui';
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
          <View style={styles.grabber} />
          <Text style={styles.title}>Comentarios</Text>
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
  overlay: { flex: 1, backgroundColor: 'rgba(4,8,18,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    height: '78%',
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 14,
  },
  title: { ...textStyles.title, fontSize: 20, marginBottom: 10 },
  errorText: { fontFamily: fonts.sansMedium, color: colors.danger, fontSize: 13, marginBottom: 8 },
  loader: { marginTop: 30 },
  list: { flex: 1 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: {
    fontFamily: fonts.sans,
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 20,
  },
  comment: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 3,
    borderLeftColor: colors.primaryBorder,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
  },
  commentPending: { borderLeftColor: colors.accent, borderStyle: 'dashed' },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author: { fontFamily: fonts.sansBold, color: colors.ink, fontSize: 13 },
  when: { fontFamily: fonts.sansMedium, color: colors.textFaint, fontSize: 11 },
  pendingBadge: { fontFamily: fonts.sansBold, color: colors.accentInk, fontSize: 11 },
  body: { fontFamily: fonts.sans, color: colors.text, fontSize: 14, marginTop: 5, lineHeight: 20 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.text,
    maxHeight: 110,
    textAlignVertical: 'top',
  },
  send: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendDisabled: { opacity: 0.5 },
  sendText: { fontFamily: fonts.sansBold, color: '#FFFFFF', fontSize: 14 },
  close: { alignItems: 'center', marginTop: 12 },
  closeText: { fontFamily: fonts.sansSemiBold, color: colors.textMuted, fontSize: 14 },
});

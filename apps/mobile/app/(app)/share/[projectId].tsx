import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Button,
  CenterLoader,
  colors,
  ErrorBanner,
  Screen,
  textStyles,
} from '../../../components/ui';
import { api } from '../../../lib/api';
import { errorMessage, useAuth } from '../../../lib/auth';
import type { ShareLink, ShareStatus, UserRole } from '../../../lib/types';

/** Validity presets offered by the app (days) — mirrors `SHARE_VALIDITY_DAYS`. */
const VALIDITY_OPTIONS = [7, 30, 90, 365] as const;

const STATUS_LABELS: Record<ShareStatus, string> = {
  ACTIVE: 'Activo',
  EXPIRED: 'Vencido',
  REVOKED: 'Revocado',
};

const STATUS_COLORS: Record<ShareStatus, string> = {
  ACTIVE: '#047857',
  EXPIRED: '#B45309',
  REVOKED: '#B91C1C',
};

function canShare(role: UserRole | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPERVISOR';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * F4.1 — read-only share links of a project (ADMIN/SUPERVISOR only).
 *
 * Creating a link returns the full URL exactly once; the API stores only the
 * token hash, so the app asks the user to share or copy it right away.
 */
export default function ShareLinksScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { token, user } = useAuth();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number>(30);
  const [creating, setCreating] = useState(false);
  const [freshLink, setFreshLink] = useState<ShareLink | null>(null);

  const load = useCallback(
    async (asRefresh = false) => {
      if (!token || !projectId) {
        return;
      }
      if (asRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        setLinks(await api.listShares(token, projectId));
      } catch (err) {
        setError(errorMessage(err));
      } finally {
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

  const createLink = async () => {
    if (!token || !projectId) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await api.createShare(token, { projectId, expiresInDays });
      setFreshLink(created);
      await load(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const shareLink = async (url: string) => {
    try {
      await Share.share({ message: `Avance de obra en FotoProy: ${url}` });
    } catch {
      // The user dismissed the sheet — nothing to report.
    }
  };

  const confirmRevoke = (link: ShareLink) => {
    Alert.alert(
      'Revocar enlace',
      'Quien tenga este enlace dejará de ver el proyecto al instante.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Revocar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!token) {
                return;
              }
              try {
                await api.revokeShare(token, link.id);
                if (freshLink?.id === link.id) {
                  setFreshLink(null);
                }
                await load(true);
              } catch (err) {
                setError(errorMessage(err));
              }
            })();
          },
        },
      ],
    );
  };

  if (!canShare(user?.role)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Compartir avance' }} />
        <View style={styles.centered}>
          <Text style={textStyles.title}>Solo ADMIN y SUPERVISOR</Text>
          <Text style={styles.hint}>Pide a un administrador que cree el enlace del proyecto.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Compartir avance' }} />
      {loading ? (
        <CenterLoader />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
          }
        >
          <ErrorBanner message={error} />

          {freshLink?.url ? (
            <View style={styles.freshCard}>
              <Text style={styles.freshTitle}>Enlace creado</Text>
              <Text selectable style={styles.freshUrl}>
                {freshLink.url}
              </Text>
              <Text style={styles.freshHint}>
                Guárdalo ahora: por seguridad no se vuelve a mostrar. Expira el{' '}
                {formatDateTime(freshLink.expiresAt)}.
              </Text>
              <Button title="Compartir enlace" onPress={() => void shareLink(freshLink.url!)} />
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nuevo enlace de solo lectura</Text>
            <Text style={styles.hint}>
              Cualquiera con el enlace verá las fotos del proyecto sin iniciar sesión.
            </Text>
            <View style={styles.chips}>
              {VALIDITY_OPTIONS.map((days) => (
                <Pressable
                  key={days}
                  accessibilityRole="button"
                  accessibilityState={{ selected: days === expiresInDays }}
                  onPress={() => setExpiresInDays(days)}
                  style={({ pressed }) => [
                    styles.chip,
                    days === expiresInDays && styles.chipSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[styles.chipText, days === expiresInDays && styles.chipTextSelected]}
                  >
                    {days} días
                  </Text>
                </Pressable>
              ))}
            </View>
            <Button title="Crear enlace" onPress={() => void createLink()} loading={creating} />
          </View>

          <Text style={textStyles.subtitle}>
            {links.length === 0
              ? 'Sin enlaces todavía'
              : `${links.length} ${links.length === 1 ? 'enlace' : 'enlaces'}`}
          </Text>

          {links.map((link) => (
            <View key={link.id} style={styles.linkRow}>
              <View style={styles.linkInfo}>
                <Text style={[styles.status, { color: STATUS_COLORS[link.status] }]}>
                  {STATUS_LABELS[link.status]}
                </Text>
                <Text style={styles.linkMeta}>Expira {formatDateTime(link.expiresAt)}</Text>
                <Text style={styles.linkMeta}>
                  {link.accessCount} {link.accessCount === 1 ? 'acceso' : 'accesos'}
                  {link.lastAccessAt ? ` · último ${formatDateTime(link.lastAccessAt)}` : ''}
                </Text>
              </View>
              {link.status === 'ACTIVE' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Revocar enlace"
                  onPress={() => confirmRevoke(link)}
                  style={({ pressed }) => [styles.revokeButton, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.revokeText}>Revocar</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: '#FFFFFF' },
  freshCard: {
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  freshTitle: { fontSize: 15, fontWeight: '700', color: '#065F46' },
  freshUrl: { color: '#065F46', fontSize: 13, fontFamily: 'monospace' },
  freshHint: { color: '#047857', fontSize: 12, lineHeight: 17 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkInfo: { flex: 1, gap: 2 },
  status: { fontSize: 13, fontWeight: '700' },
  linkMeta: { color: colors.textMuted, fontSize: 12 },
  revokeButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FEE2E2',
  },
  revokeText: { color: '#B91C1C', fontSize: 13, fontWeight: '700' },
});

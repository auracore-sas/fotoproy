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
  Banner,
  Button,
  CenterLoader,
  colors,
  elevations,
  FilterChip,
  fonts,
  radius,
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
          <Banner
            tone="error"
            message={error}
            actionLabel={error ? 'Reintentar' : undefined}
            onAction={error ? () => void load() : undefined}
          />
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
                <FilterChip
                  key={days}
                  label={`${days} días`}
                  active={days === expiresInDays}
                  onPress={() => setExpiresInDays(days)}
                />
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
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  hint: { ...textStyles.caption, lineHeight: 19 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    ...elevations.card,
  },
  cardTitle: { ...textStyles.heading, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  freshCard: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.lg,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  freshTitle: { ...textStyles.heading, fontSize: 16, color: '#065F46' },
  freshUrl: {
    fontFamily: fonts.sansMedium,
    color: '#065F46',
    fontSize: 12.5,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.sm,
    padding: 10,
  },
  freshHint: {
    fontFamily: fonts.sans,
    color: '#047857',
    fontSize: 12.5,
    lineHeight: 18,
  },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
    ...elevations.card,
  },
  linkInfo: { flex: 1, gap: 3 },
  status: { fontFamily: fonts.sansBold, fontSize: 13 },
  linkMeta: { fontFamily: fonts.sansMedium, color: colors.textMuted, fontSize: 12 },
  revokeButton: {
    borderRadius: radius.sm,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  revokeText: { fontFamily: fonts.sansBold, color: colors.danger, fontSize: 13 },
});

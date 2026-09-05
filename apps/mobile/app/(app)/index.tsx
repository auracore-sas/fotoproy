import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Button, CenterLoader, colors, ErrorBanner, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';
import { listCachedProjects, replaceCachedProjects } from '../../lib/db';
import { useSync } from '../../lib/sync';
import type { Project } from '../../lib/types';

export default function ProjectsScreen() {
  const router = useRouter();
  const { token, user, signOut } = useAuth();
  const { online } = useSync();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the server is unreachable and we are showing the local cache.
  const [offline, setOffline] = useState(false);
  const prevOnlineRef = useRef(online);

  const load = useCallback(
    async (asRefresh = false) => {
      if (!token) {
        return;
      }
      if (asRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      setOffline(false);
      try {
        const page = await api.listProjects(token);
        setProjects(page.items);
        // Keep the last known server snapshot for offline sessions.
        void replaceCachedProjects(page.items);
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) {
          // Offline: fall back to the cached project list (still tappable).
          const cached = await listCachedProjects();
          if (cached.length > 0) {
            setProjects(cached as unknown as Project[]);
            setOffline(true);
            return;
          }
        }
        setError(errorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  // When connectivity comes back, refetch so the cache fallback clears.
  useEffect(() => {
    const reconnected = online && !prevOnlineRef.current;
    prevOnlineRef.current = online;
    if (reconnected && offline) {
      void load();
    }
  }, [online, offline, load]);

  // Reload whenever the screen regains focus (e.g. after creating a project).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onLogout = async () => {
    await signOut();
    // The (app) layout redirects to /login once the session is cleared.
  };

  const renderItem = ({ item }: { item: Project }) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/project/${item.id}`)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.code}>{item.code}</Text>
        <Text style={styles.status} numberOfLines={1}>
          {item.clientName ?? 'Sin cliente'}
        </Text>
      </View>
      <Text style={styles.name}>{item.name}</Text>
      {item.description ? (
        <Text style={styles.description} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
    </Pressable>
  );

  return (
    <Screen>
      <View style={styles.headerRow}>
        <View style={styles.greeting}>
          <Text style={styles.greetingTitle}>Hola, {user?.fullName?.split(' ')[0] ?? ''} 👷</Text>
          <Text style={styles.greetingOrg}>{user?.organizationName}</Text>
        </View>
        <View style={styles.actions}>
          <Button title="+ Nuevo" variant="secondary" onPress={() => router.push('/new-project')} />
          <Pressable onPress={onLogout} style={styles.logout}>
            <Text style={styles.logoutText}>Salir</Text>
          </Pressable>
        </View>
      </View>

      <ErrorBanner message={error} />
      {offline ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            {online
              ? 'No se pudo conectar al servidor: mostrando proyectos guardados. Reintentando…'
              : 'Sin conexión: mostrando proyectos guardados. Los cambios se actualizarán al reconectar.'}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <CenterLoader />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Aún no hay proyectos</Text>
              <Text style={styles.emptyText}>
                Crea tu primer proyecto para empezar a documentar la obra.
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  greeting: { flex: 1 },
  greetingTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  greetingOrg: { fontSize: 13, color: colors.textMuted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logout: { paddingHorizontal: 10, paddingVertical: 6 },
  logoutText: { color: colors.danger, fontWeight: '600' },
  offlineBanner: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  offlineBannerText: { color: colors.primary, fontSize: 13, lineHeight: 18 },
  list: { paddingHorizontal: 20, paddingBottom: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  code: { fontSize: 13, fontWeight: '700', color: colors.primary },
  status: { fontSize: 12, color: colors.textMuted },
  name: { fontSize: 17, fontWeight: '600', color: colors.text },
  description: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  emptyText: { fontSize: 14, color: colors.textMuted, marginTop: 6, textAlign: 'center' },
});

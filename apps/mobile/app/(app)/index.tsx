import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  Banner,
  BrandMark,
  colors,
  elevations,
  EmptyState,
  ErrorState,
  fonts,
  radius,
  Screen,
  Stat,
  textStyles,
} from '../../components/ui';
import { SyncBar } from '../../components/sync-indicator';
import { api, ApiError } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';
import { listCachedProjects, replaceCachedProjects } from '../../lib/db';
import { useSync } from '../../lib/sync';
import type { Project } from '../../lib/types';

export default function ProjectsScreen() {
  const router = useRouter();
  const { token, user, signOut } = useAuth();
  const { online, pendingCount } = useSync();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the server is unreachable and we are showing the local cache.
  const [offline, setOffline] = useState(false);
  const retryBusyRef = useRef(false);
  // Only the first load blocks; later focus reloads keep the current list.
  const loadedOnceRef = useRef(false);

  const load = useCallback(
    async (asRefresh = false) => {
      if (!token) {
        return;
      }
      if (asRefresh) {
        setRefreshing(true);
      } else if (!loadedOnceRef.current) {
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
        loadedOnceRef.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  // Silent refetch (no loader flicker): flips state only when the server answers.
  const refreshListSilently = useCallback(async () => {
    if (!token || retryBusyRef.current) {
      return;
    }
    retryBusyRef.current = true;
    try {
      const page = await api.listProjects(token);
      setProjects(page.items);
      void replaceCachedProjects(page.items);
      setOffline(false);
    } catch {
      // Server still unreachable — keep showing the cached list + banner.
    } finally {
      retryBusyRef.current = false;
    }
  }, [token]);

  // While showing cached data with connectivity, retry periodically until the
  // server responds (a single retry can race the network coming back).
  useEffect(() => {
    if (!offline || !online) {
      return undefined;
    }
    void refreshListSilently();
    const timer = setInterval(() => void refreshListSilently(), 5_000);
    return () => clearInterval(timer);
  }, [offline, online, refreshListSilently]);

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

  const firstName = user?.fullName?.trim().split(/\s+/)[0] ?? '';

  const renderItem = useCallback(
    ({ item }: { item: Project }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Abrir proyecto ${item.name}`}
        onPress={() => router.push(`/project/${item.id}`)}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.cardHead}>
          <View style={styles.codePill}>
            <Text style={styles.codeText}>{item.code}</Text>
          </View>
          <View style={styles.chevronWrap}>
            <Text style={styles.chevron}>›</Text>
          </View>
        </View>
        <Text style={styles.cardName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.cardClient} numberOfLines={1}>
          {item.clientName ?? 'Sin cliente'}
        </Text>
        {item.description ? (
          <Text style={styles.cardDescription} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
      </Pressable>
    ),
    [router],
  );

  return (
    <Screen edges={['top']}>
      {/* Brand header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <BrandMark size={40} />
          <View style={styles.headerText}>
            <Text style={styles.hello} numberOfLines={1}>
              {firstName ? `Hola, ${firstName}` : 'Hola'}
            </Text>
            <Text style={styles.org} numberOfLines={1}>
              {user?.organizationName}
            </Text>
          </View>
          <Pressable
            onPress={onLogout}
            accessibilityRole="button"
            accessibilityLabel="Cerrar sesión"
            hitSlop={6}
            style={({ pressed }) => [styles.logout, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.logoutText}>Salir</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            accessibilityLabel="Perfil"
          >
            <Avatar name={user?.fullName} size={42} />
          </Pressable>
        </View>

        <View style={styles.bannerArea}>
          <SyncBar />
          {error && projects.length > 0 ? (
            <Banner
              tone="error"
              message={error}
              actionLabel="Reintentar"
              onAction={() => void load()}
            />
          ) : null}
          {offline ? (
            <Banner
              tone="info"
              icon="📶"
              message={
                online
                  ? 'No se pudo conectar al servidor: mostrando proyectos guardados.'
                  : 'Sin conexión: mostrando proyectos guardados. Se actualizarán al reconectar.'
              }
              actionLabel="Reintentar ahora"
              onAction={() => void refreshListSilently()}
            />
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <View style={styles.statsCard}>
            <Stat label="Proyectos" value="—" />
            <View style={styles.statRule} />
            <Stat label="Pendientes" value="—" />
          </View>
        </View>
      ) : error && projects.length === 0 ? (
        <ErrorState
          title="No se pudieron cargar los proyectos"
          message={error}
          onRetry={() => void load()}
        />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <View style={styles.statsCard}>
                <Stat
                  label={projects.length === 1 ? 'Proyecto' : 'Proyectos'}
                  value={projects.length}
                />
                <View style={styles.statRule} />
                <Stat
                  label={pendingCount === 1 ? 'Pendiente' : 'Pendientes'}
                  value={pendingCount}
                />
              </View>
              <Text style={styles.sectionLabel}>Tus proyectos</Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="🏗️"
              title="Tu primer proyecto"
              text="Crea un proyecto para empezar a documentar la obra con fotos ancladas al plano."
              actionLabel="+ Nuevo proyecto"
              onAction={() => router.push('/new-project')}
            />
          }
        />
      )}

      {/* Floating action button — thumb-friendly for field use */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nuevo proyecto"
        onPress={() => router.push('/new-project')}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Text style={styles.fabGlyph}>＋</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1 },
  hello: { ...textStyles.heading, fontSize: 18 },
  org: { ...textStyles.caption, marginTop: 1 },
  logout: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  logoutText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.danger },
  bannerArea: { marginTop: 12 },

  loadingWrap: { paddingHorizontal: 20, paddingTop: 4 },
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  listHeader: { gap: 4 },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 18,
    ...elevations.card,
  },
  statRule: { width: 1, height: 30, backgroundColor: colors.line },
  sectionLabel: {
    ...textStyles.micro,
    marginTop: 22,
    marginBottom: 10,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 12,
    ...elevations.card,
  },
  cardPressed: { backgroundColor: colors.surfaceAlt, transform: [{ scale: 0.99 }] },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  codePill: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  codeText: {
    fontFamily: fonts.displayBold,
    fontSize: 12.5,
    letterSpacing: 0.8,
    color: colors.primaryDeep,
  },
  chevronWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: { fontFamily: fonts.sansBold, fontSize: 17, color: colors.textFaint, marginTop: -2 },
  cardName: { ...textStyles.heading, fontSize: 18, marginTop: 10 },
  cardClient: { ...textStyles.caption, marginTop: 3 },
  cardDescription: { ...textStyles.subtitle, fontSize: 13.5, marginTop: 8 },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevations.floating,
  },
  fabPressed: { backgroundColor: colors.primaryPressed, transform: [{ scale: 0.96 }] },
  fabGlyph: { color: '#FFFFFF', fontSize: 26, fontFamily: fonts.sansMedium, marginTop: -2 },
});

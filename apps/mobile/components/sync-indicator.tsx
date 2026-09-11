/**
 * Global sync status bar (F2.7) — shows how many media items are waiting to
 * be uploaded, an explicit “sync now” action and connectivity/error states.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './ui';
import { useSync } from '../lib/sync';

export function SyncBar() {
  const { online, syncing, pendingCount, lastError, syncNow } = useSync();

  if (!syncing && pendingCount === 0 && !lastError) {
    return null; // everything is uploaded — nothing to show
  }

  if (syncing) {
    return (
      <View style={[styles.bar, styles.barInfo]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.barText}>Subiendo medios…</Text>
      </View>
    );
  }

  if (!online && pendingCount > 0) {
    return (
      <View style={[styles.bar, styles.barWarn]}>
        <Text style={styles.barText}>
          Sin conexión · {plural(pendingCount)} por subir. Se sincronizarán solas al reconectar.
        </Text>
      </View>
    );
  }

  if (pendingCount > 0) {
    return (
      <View style={[styles.bar, styles.barWarn]}>
        <Text style={[styles.barText, { flex: 1 }]}>
          {plural(pendingCount)} por subir{lastError ? ` · ${lastError}` : ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sincronizar ahora"
          onPress={() => void syncNow()}
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.actionText}>Sincronizar ahora</Text>
        </Pressable>
      </View>
    );
  }

  // pendingCount === 0 but a global error remains (e.g. expired session).
  return (
    <View style={[styles.bar, styles.barError]}>
      <Text style={styles.barText}>{lastError ?? 'Error de sincronización'}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reintentar"
        onPress={() => void syncNow()}
        style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}
      >
        <Text style={styles.actionText}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

function plural(count: number): string {
  return `${count} ${count === 1 ? 'pendiente' : 'pendientes'}`;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 8,
    marginBottom: 6,
  },
  barInfo: { backgroundColor: '#EFF6FF' },
  barWarn: { backgroundColor: '#FEF3C7' },
  barError: { backgroundColor: '#FEE2E2' },
  barText: { color: colors.text, fontSize: 13, fontWeight: '500', flexShrink: 1 },
  action: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});

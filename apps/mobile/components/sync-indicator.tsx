/**
 * Global sync status bar (F2.7, polished in F4.3) — shows how many items are
 * waiting to be uploaded, an explicit “sync now” action and connectivity/error
 * states. Rendered on every browsing screen so the pending count is always the
 * same number, wherever the user is.
 */
import React from 'react';
import { Banner } from './ui';
import { useSync } from '../lib/sync';

export function SyncBar() {
  const { online, syncing, pendingCount, lastError, syncNow } = useSync();

  if (syncing) {
    return (
      <Banner
        tone="info"
        loading
        message={pendingCount > 0 ? `Subiendo ${plural(pendingCount)}…` : 'Sincronizando…'}
      />
    );
  }

  if (!online && pendingCount > 0) {
    return (
      <Banner
        tone="warn"
        icon="✈️"
        message={`Sin conexión · ${plural(pendingCount)} por subir. Se sincronizarán solas al reconectar.`}
      />
    );
  }

  if (pendingCount > 0) {
    return (
      <Banner
        tone="warn"
        message={`${plural(pendingCount)} por subir${lastError ? ` · ${lastError}` : ''}`}
        actionLabel="Sincronizar ahora"
        onAction={() => void syncNow()}
      />
    );
  }

  if (lastError) {
    // Nothing queued but a global error remains (e.g. expired session).
    return (
      <Banner
        tone="error"
        message={lastError}
        actionLabel="Reintentar"
        onAction={() => void syncNow()}
      />
    );
  }

  return null; // everything is uploaded — nothing to show
}

function plural(count: number): string {
  return `${count} ${count === 1 ? 'pendiente' : 'pendientes'}`;
}

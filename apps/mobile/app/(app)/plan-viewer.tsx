import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';
import {
  createLocalPin,
  enqueueSync,
  listLocalPhotos,
  listLocalPins,
  markPinSynced,
} from '../../lib/db';
import type { LocalPin } from '../../lib/db';
import { generateId } from '../../lib/id';
import { useSync } from '../../lib/sync';
import type { Pin, Plan } from '../../lib/types';

interface LocalMedia {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  localUri: string | null;
  capturedAt: string;
}

/** Contains an image (aspect) inside W×H → fitted rectangle. */
function containFit(W: number, H: number, aspect: number): { w: number; h: number } {
  if (aspect <= 0) {
    return { w: W, h: H };
  }
  const w = Math.min(W, H * aspect);
  return { w, h: w / aspect };
}

export default function PlanViewerScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { token } = useAuth();
  const { online } = useSync();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Zoom/pan.
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const boxRef = useRef(box);
  boxRef.current = box;
  const planRef = useRef(plan);
  planRef.current = plan;
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const aspectRef = useRef(0); // natural aspect of the plan image
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const tapStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const containerRef = useRef<View | null>(null);
  const containerOrigin = useRef({ x: 0, y: 0 });

  // Pins (server + local pending) and anchoring flow.
  const [serverPins, setServerPins] = useState<Pin[]>([]);
  const [localPins, setLocalPins] = useState<LocalPin[]>([]);
  const [anchorAt, setAnchorAt] = useState<{ x: number; y: number } | null>(null); // %
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localMedia, setLocalMedia] = useState<LocalMedia[]>([]);
  const [savingPin, setSavingPin] = useState(false);
  const [photoPickerBusy, setPhotoPickerBusy] = useState(false);

  const apply = useCallback((nextScale: number, nextOffset?: { x: number; y: number }) => {
    const clamped = Math.min(5, Math.max(1, nextScale));
    scaleRef.current = clamped;
    if (nextOffset) {
      offsetRef.current = nextOffset;
    }
    setScale(clamped);
    setOffset({ ...offsetRef.current });
  }, []);

  const loadPins = useCallback(async () => {
    if (!token || !planId) {
      return;
    }
    const [server, local] = await Promise.all([
      api.listPlanPins(token, planId).catch(() => [] as Pin[]),
      listLocalPins(planId).catch(() => [] as LocalPin[]),
    ]);
    setServerPins(server);
    setLocalPins(local);
  }, [token, planId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!token || !planId) {
        return;
      }
      try {
        const data = await api.getPlan(token, planId);
        if (mounted) {
          setPlan(data);
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
  }, [token, planId]);

  useEffect(() => {
    void loadPins();
  }, [loadPins, online]);

  const measureContainer = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      containerOrigin.current = { x, y };
    });
  }, []);

  // ---------------------------------------------------------------- gestures
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          pinchStart.current = {
            distance: Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            ),
            scale: scaleRef.current,
          };
        }
        tapStart.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY, time: Date.now() };
      },
      onPanResponderMove: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2 && pinchStart.current) {
          const distance = Math.hypot(
            touches[0].pageX - touches[1].pageX,
            touches[0].pageY - touches[1].pageY,
          );
          apply(pinchStart.current.scale * (distance / pinchStart.current.distance));
          return;
        }
        if (scaleRef.current > 1) {
          const limit = 1200;
          apply(scaleRef.current, {
            x: Math.min(limit, Math.max(-limit, offsetRef.current.x + gesture.dx)),
            y: Math.min(limit, Math.max(-limit, offsetRef.current.y + gesture.dy)),
          });
        }
      },
      onPanResponderRelease: (evt) => {
        pinchStart.current = null;
        const start = tapStart.current;
        tapStart.current = null;
        if (!start) {
          return;
        }
        const moved = Math.hypot(evt.nativeEvent.pageX - start.x, evt.nativeEvent.pageY - start.y);
        const duration = Date.now() - start.time;
        if (moved > 10 || duration > 350) {
          return; // drag, not a tap
        }
        const now = Date.now();
        if (now - lastTap.current < 300) {
          // Double tap → toggle zoom.
          apply(scaleRef.current > 1 ? 1 : 2.5, { x: 0, y: 0 });
          lastTap.current = 0;
          return;
        }
        lastTap.current = now;
        // Single tap → wait briefly to confirm it is not a double tap, then
        // interpret the point on the plan and offer anchoring. Coordinates are
        // read NOW (RN nullifies synthetic events after the handler returns).
        const { pageX, pageY } = evt.nativeEvent;
        setTimeout(() => {
          if (lastTap.current === now && boxRef.current && planRef.current) {
            const pct = pointToPercentage(pageX, pageY);
            if (pct) {
              setAnchorAt(pct);
            }
          }
        }, 300);
      },
      onPanResponderTerminate: () => {
        pinchStart.current = null;
        tapStart.current = null;
      },
    }),
  ).current;

  /** Maps a screen point to (x%, y%) on the plan (0–100), or null outside. */
  const pointToPercentage = (pageX: number, pageY: number): { x: number; y: number } | null => {
    const currentBox = boxRef.current;
    if (!currentBox) {
      return null;
    }
    const W = currentBox.width;
    const H = currentBox.height;
    const cx = pageX - containerOrigin.current.x;
    const cy = pageY - containerOrigin.current.y;
    const s = scaleRef.current;
    const o = offsetRef.current;
    const fit = containFit(W, H, aspectRef.current);
    // Content top-left inside the container (centered, scaled, translated).
    const left = (W - fit.w * s) / 2 + o.x;
    const top = (H - fit.h * s) / 2 + o.y;
    if (cx < left || cy < top || cx > left + fit.w * s || cy > top + fit.h * s) {
      return null; // tapped the letterbox
    }
    const localX = (cx - left) / s;
    const localY = (cy - top) / s;
    return {
      x: Math.min(100, Math.max(0, (localX / fit.w) * 100)),
      y: Math.min(100, Math.max(0, (localY / fit.h) * 100)),
    };
  };

  /** Marker position (container coordinates) for a pin percentage. */
  const markerPoint = (pctX: number, pctY: number): { left: number; top: number } => {
    const W = box?.width ?? 1;
    const H = box?.height ?? 1;
    const s = scaleRef.current;
    const o = offsetRef.current;
    const fit = containFit(W, H, aspectRef.current);
    return {
      left: (W - fit.w * s) / 2 + o.x + (pctX / 100) * fit.w * s,
      top: (H - fit.h * s) / 2 + o.y + (pctY / 100) * fit.h * s,
    };
  };

  // Merge server pins with local pending pins (same id dedupe).
  const pinsToDraw = useMemo(() => {
    const syncedIds = new Set(serverPins.map((p) => p.id));
    const synced: Array<{ id: string; x: number; y: number; pending: boolean; photoId: string }> =
      serverPins.map((p) => ({
        id: p.id,
        x: p.xPercentage,
        y: p.yPercentage,
        pending: false,
        photoId: p.photoId,
      }));
    const pending = localPins
      .filter((lp) => !syncedIds.has(lp.id) && lp.syncedAt == null)
      .map((lp) => ({
        id: lp.id,
        x: lp.xPercentage,
        y: lp.yPercentage,
        pending: true,
        photoId: lp.photoId,
      }));
    return [...synced, ...pending];
  }, [serverPins, localPins]);

  const onAnchorChoice = async (photoId: string) => {
    if (!planId || !anchorAt) {
      return;
    }
    setSavingPin(true);
    try {
      const id = generateId();
      await createLocalPin({
        id,
        planId,
        photoId,
        pageNumber: 1,
        xPercentage: anchorAt.x,
        yPercentage: anchorAt.y,
      });
      await enqueueSync('pin', id, {
        planId,
        photoId,
        pageNumber: 1,
        x: anchorAt.x,
        y: anchorAt.y,
      });
      // Try an immediate online sync (photo may still be pending → retry later).
      if (token && online) {
        try {
          await api.createPin(token, {
            id,
            planId,
            photoId,
            pageNumber: 1,
            xPercentage: anchorAt.x,
            yPercentage: anchorAt.y,
          });
          await markPinSynced(id, new Date().toISOString());
        } catch {
          // Queue handles it (FIFO after the photo uploads).
        }
      }
      setAnchorAt(null);
      setPickerOpen(false);
      void loadPins();
    } catch (err) {
      Alert.alert('No se pudo anclar', errorMessage(err));
    } finally {
      setSavingPin(false);
    }
  };

  const openPhotoPicker = async () => {
    if (!plan?.projectId) {
      return;
    }
    setPhotoPickerBusy(true);
    try {
      const rows = await listLocalPhotos(plan.projectId);
      setLocalMedia(
        rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          localUri: r.thumbnailUri ?? r.localUri,
          capturedAt: r.capturedAt,
        })) as LocalMedia[],
      );
      setPickerOpen(true);
    } finally {
      setPhotoPickerBusy(false);
    }
  };

  const takeNow = () => {
    if (!plan?.projectId) {
      return;
    }
    // Keep the anchor: after shooting, pick the new photo from the picker.
    router.push({ pathname: '/capture', params: { projectId: plan.projectId } });
  };

  if (loading) {
    return (
      <View style={styles.full}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!plan || error) {
    return (
      <View style={styles.full}>
        <Text style={styles.errorText}>{error ?? 'Plano no disponible.'}</Text>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
        >
          <Text style={styles.backText}>← Volver</Text>
        </Pressable>
      </View>
    );
  }

  const isPdf = plan.planKind === 'PDF';

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel="Cerrar plano"
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {plan.title}
        </Text>
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/plan-photos',
              params: { planId: plan.id, planTitle: plan.title },
            })
          }
          style={styles.photosButton}
          accessibilityRole="button"
          accessibilityLabel="Ver fotos del plano"
        >
          <Text style={styles.photosButtonText}>📋</Text>
        </Pressable>
        <Text style={styles.pinCount}>{pinsToDraw.length} 📍</Text>
      </View>

      {isPdf ? (
        <View style={styles.full}>
          <Text style={styles.pdfHint}>
            📄 Los planos PDF aún no se visualizan en Expo Go — llegarán con el visor WebView/pdf.js
            (F3.0). Mientras tanto puedes usar planos en imagen.
          </Text>
        </View>
      ) : (
        <View
          ref={containerRef}
          style={styles.imageArea}
          onLayout={(e) => {
            const next = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
            setBox(next);
            measureContainer();
          }}
          {...panResponder.panHandlers}
        >
          {box ? (
            <View
              style={[
                styles.canvas,
                { transform: [{ translateX: offset.x }, { translateY: offset.y }] },
              ]}
            >
              <Image
                source={{ uri: plan.fileUrl }}
                style={{ width: box.width * scale, height: box.height * scale }}
                resizeMode="contain"
                onLoad={(e) => {
                  const { width, height } = e.nativeEvent.source;
                  if (width > 0 && height > 0) {
                    aspectRef.current = width / height;
                  }
                }}
                onError={() =>
                  setError('No se pudo cargar el plano. Reintenta (la URL pudo expirar).')
                }
              />
              {pinsToDraw.map((pin) => {
                const pt = markerPoint(pin.x, pin.y);
                return (
                  <Pressable
                    key={pin.id}
                    onPress={() => {
                      if (pin.pending) {
                        Alert.alert(
                          'Pin pendiente',
                          'Aún no está sincronizado: se subirá cuando haya conexión.',
                        );
                        return;
                      }
                      router.push({ pathname: '/media-viewer', params: { remoteId: pin.photoId } });
                    }}
                    style={[styles.pin, { left: pt.left - 14, top: pt.top - 14 }]}
                    accessibilityRole="button"
                    accessibilityLabel={
                      pin.pending ? 'Pin pendiente de sincronizar' : 'Abrir foto anclada'
                    }
                  >
                    <View style={[styles.pinDot, pin.pending && styles.pinDotPending]}>
                      {pin.pending ? <Text style={styles.pinPendingText}>⏫</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <ActivityIndicator size="large" color="#FFFFFF" />
          )}
        </View>
      )}

      {/* Anchor sheet */}
      <Modal
        visible={anchorAt !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAnchorAt(null)}
      >
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>📍 Anclar aquí</Text>
            <Text style={styles.sheetHint}>
              {anchorAt ? `Posición: ${anchorAt.x.toFixed(1)}%, ${anchorAt.y.toFixed(1)}%` : ''} —
              adjunta una foto de evidencia en este punto del plano.
            </Text>
            <Pressable
              onPress={() => void openPhotoPicker()}
              style={styles.sheetAction}
              accessibilityRole="button"
              disabled={photoPickerBusy || !plan}
            >
              <Text style={styles.sheetActionTitle}>🖼️ Usar una foto existente</Text>
              <Text style={styles.sheetActionSub}>Elige entre las fotos de este proyecto</Text>
            </Pressable>
            <Pressable
              onPress={takeNow}
              style={styles.sheetAction}
              accessibilityRole="button"
              disabled={!plan}
            >
              <Text style={styles.sheetActionTitle}>📷 Tomar foto ahora</Text>
              <Text style={styles.sheetActionSub}>Abre la cámara y luego elige la nueva foto</Text>
            </Pressable>
            <Pressable
              onPress={() => setAnchorAt(null)}
              style={styles.cancel}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Photo picker */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, styles.pickerSheet]}>
            <Text style={styles.sheetTitle}>Elegir foto del proyecto</Text>
            <Text style={styles.sheetHint}>
              {savingPin ? 'Anclando…' : 'Selecciona la foto que corresponde a este punto.'}
            </Text>
            <FlatList
              data={localMedia}
              keyExtractor={(item) => item.id}
              numColumns={3}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => void onAnchorChoice(item.id)}
                  disabled={savingPin}
                  style={styles.mediaTile}
                  accessibilityRole="button"
                >
                  {item.localUri ? (
                    <Image
                      source={{ uri: item.localUri }}
                      style={styles.mediaThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.mediaThumb, styles.mediaPlaceholder]}>
                      <Text style={styles.mediaGlyph}>{item.kind === 'VIDEO' ? '▶' : '📷'}</Text>
                    </View>
                  )}
                  <View style={styles.mediaTileStatus}>
                    {item.kind === 'VIDEO' ? <Text style={styles.mediaTileIcon}>🎥</Text> : null}
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyMedia}>
                  No hay fotos locales de este proyecto aún. Usa “Tomar foto ahora”.
                </Text>
              }
            />
            <Pressable
              onPress={() => setPickerOpen(false)}
              style={styles.cancel}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cancelar</Text>
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
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  topTitle: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '600', marginHorizontal: 12 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  pinCount: { color: '#FDE68A', fontSize: 13, fontWeight: '700' },
  photosButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  photosButtonText: { fontSize: 16 },
  imageArea: { flex: 1, overflow: 'hidden' },
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pin: {
    position: 'absolute',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDotPending: { backgroundColor: '#F59E0B', borderStyle: 'dashed' },
  pinPendingText: { fontSize: 10 },
  errorText: { color: '#E2E8F0', fontSize: 15, textAlign: 'center', marginHorizontal: 24 },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  backText: { color: '#FFFFFF', fontWeight: '700' },
  pdfHint: {
    color: '#E2E8F0',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginHorizontal: 28,
  },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 34,
  },
  pickerSheet: { height: '72%' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  sheetHint: { fontSize: 13, color: colors.textMuted, marginTop: 6, lineHeight: 19 },
  sheetAction: {
    marginTop: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  sheetActionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  sheetActionSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  cancel: { alignItems: 'center', marginTop: 14 },
  cancelText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  mediaTile: { flex: 1 / 3, aspectRatio: 1, padding: 3 },
  mediaThumb: { width: '100%', height: '100%', borderRadius: 8 },
  mediaPlaceholder: { backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  mediaGlyph: { fontSize: 20, color: 'rgba(255,255,255,0.7)' },
  mediaTileStatus: { position: 'absolute', bottom: 6, left: 6 },
  mediaTileIcon: { fontSize: 12 },
  emptyMedia: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingTop: 24 },
});

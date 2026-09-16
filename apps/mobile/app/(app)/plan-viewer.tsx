import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, fonts, radius } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';
import {
  createLocalPin,
  dropQueuedEntityOps,
  enqueueSync,
  getLocalPhoto,
  listLocalPhotos,
  listLocalPins,
  markPinSynced,
  removeLocalPin,
} from '../../lib/db';
import type { LocalPin } from '../../lib/db';
import { generateId } from '../../lib/id';
import { cachePlan, localPlanUri } from '../../lib/plan-cache';
import { useSync } from '../../lib/sync';
import type { Pin, Plan } from '../../lib/types';

interface LocalMedia {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  localUri: string | null;
  capturedAt: string;
}

/** A pin merged from the server list and the local (offline) queue. */
interface DrawnPin {
  id: string;
  photoId: string;
  x: number;
  y: number;
  pending: boolean;
  thumbnailUri: string | null;
  capturedAt: string | null;
}

/** Contains an image (aspect) inside W×H → fitted rectangle. */
function containFit(W: number, H: number, aspect: number): { w: number; h: number } {
  if (aspect <= 0) {
    return { w: W, h: H };
  }
  const w = Math.min(W, H * aspect);
  return { w, h: w / aspect };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Short local date+time for pin cards. */
function formatDateTime(iso: string | null): string {
  if (!iso) {
    return '';
  }
  return new Date(iso).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const MAX_SCALE = 8;
const MIN_SCALE = 1;
/** Counter-scale curve for map-style markers (keeps them ~constant on screen). */
const SCALE_INPUT = [1, 1.5, 2, 3, 4, 6, 8];
const INVERSE_OUTPUT = SCALE_INPUT.map((value) => 1 / value);
/** Markers live in screen space: constant visual size and touch target. */
const MARKER_SIZE = 48;
const PIN_VISUAL = 30;
/** A tap this close (screen px) to a marker selects it — no pixel hunting. */
const TAP_TOLERANCE = 44;

interface MarkerProps {
  pin: DrawnPin;
  boxWidth: number;
  boxHeight: number;
  fitWidth: number;
  fitHeight: number;
  selected: boolean;
  scaleAnim: Animated.Value;
  offsetAnim: Animated.ValueXY;
  onSelect: (pin: DrawnPin) => void;
}

/**
 * Marker drawn in screen space (not inside the zoomed canvas). Its size and
 * touch area stay constant at any zoom level — the previous in-canvas markers
 * shrank with the counter-scale, which made them almost impossible to tap once
 * the user zoomed in to place a photo.
 */
const Marker = React.memo(function Marker({
  pin,
  boxWidth,
  boxHeight,
  fitWidth,
  fitHeight,
  selected,
  scaleAnim,
  offsetAnim,
  onSelect,
}: MarkerProps) {
  const position = useMemo(() => {
    // Container coords of the anchor: canvas center + offset, then the canvas
    // point (scaled about the canvas center).
    const left = Animated.add(
      Animated.add(boxWidth / 2, offsetAnim.x),
      Animated.multiply((pin.x / 100) * fitWidth - fitWidth / 2, scaleAnim),
    );
    const top = Animated.add(
      Animated.add(boxHeight / 2, offsetAnim.y),
      Animated.multiply((pin.y / 100) * fitHeight - fitHeight / 2, scaleAnim),
    );
    return {
      left: Animated.subtract(left, MARKER_SIZE / 2),
      top: Animated.subtract(top, MARKER_SIZE / 2),
    };
  }, [boxWidth, boxHeight, fitWidth, fitHeight, pin.x, pin.y, scaleAnim, offsetAnim]);

  return (
    <Animated.View style={[styles.markerWrap, position]}>
      <Pressable
        onPress={() => onSelect(pin)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={
          pin.pending ? 'Anclaje pendiente de sincronizar' : 'Foto anclada: ver o quitar'
        }
        style={styles.markerPress}
      >
        <View
          style={[
            styles.pinBody,
            pin.pending && styles.pinBodyPending,
            selected && styles.pinBodySelected,
          ]}
        >
          {pin.pending ? <Text style={styles.pinGlyph}>⏫</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
});

export default function PlanViewerScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { token } = useAuth();
  const { online } = useSync();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [offlineImage, setOfflineImage] = useState(false);

  // Layout + transform (animated values keep gestures off the React render path).
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [aspect, setAspect] = useState(0);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const offsetAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const aspectRef = useRef(0);
  const boxRef = useRef<{ width: number; height: number } | null>(null);
  const containerRef = useRef<View | null>(null);
  const containerOrigin = useRef({ x: 0, y: 0 });

  // Anchoring (placement mode) + pins.
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const [pointer, setPointer] = useState({ x: 0, y: 0 }); // canvas coords
  const pointerRef = useRef({ x: 0, y: 0 });
  const dragGrab = useRef<{
    pointer: { x: number; y: number };
    touch: { x: number; y: number };
  } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localMedia, setLocalMedia] = useState<LocalMedia[]>([]);
  const [savingPin, setSavingPin] = useState(false);
  const [photoPickerBusy, setPhotoPickerBusy] = useState(false);
  const [serverPins, setServerPins] = useState<Pin[]>([]);
  const [localPins, setLocalPins] = useState<LocalPin[]>([]);
  /** Local thumbnails of pending pins (their photo may not be on the server yet). */
  const [localThumbs, setLocalThumbs] = useState<
    Record<string, { uri: string | null; capturedAt: string }>
  >({});
  const [selected, setSelected] = useState<DrawnPin | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const momentumRef = useRef<number | null>(null);
  /** Pins as drawn (read by the gesture handlers, which run outside React). */
  const drawnPinsRef = useRef<DrawnPin[]>([]);

  const pinScale = useMemo(
    () =>
      scaleAnim.interpolate({
        inputRange: SCALE_INPUT,
        outputRange: INVERSE_OUTPUT,
        extrapolate: 'clamp',
      }),
    [scaleAnim],
  );

  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);
  useEffect(() => {
    aspectRef.current = aspect;
  }, [aspect]);
  useEffect(() => {
    boxRef.current = box;
  }, [box]);
  useEffect(
    () => () => {
      if (momentumRef.current !== null) {
        cancelAnimationFrame(momentumRef.current);
      }
    },
    [],
  );

  /** Fitted canvas size for the current container and plan aspect. */
  const fit = useMemo(() => {
    if (!box) {
      return { w: 0, h: 0 };
    }
    return containFit(box.width, box.height, aspect);
  }, [box, aspect]);
  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  const applyTransform = useCallback(
    (nextScale: number, nextOffset: { x: number; y: number }) => {
      scaleRef.current = nextScale;
      offsetRef.current = nextOffset;
      scaleAnim.setValue(nextScale);
      offsetAnim.setValue(nextOffset);
    },
    [offsetAnim, scaleAnim],
  );

  /** Keeps the plan covering the viewport (photo-viewer style clamping). */
  const clampOffset = useCallback((x: number, y: number, scale: number) => {
    const currentBox = boxRef.current;
    const currentFit = fitRef.current;
    if (!currentBox) {
      return { x, y };
    }
    const maxX = Math.max(0, (currentFit.w * scale - currentBox.width) / 2);
    const maxY = Math.max(0, (currentFit.h * scale - currentBox.height) / 2);
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  const setPointerAt = useCallback((point: { x: number; y: number }) => {
    const currentFit = fitRef.current;
    const clamped = {
      x: clamp(point.x, 0, currentFit.w),
      y: clamp(point.y, 0, currentFit.h),
    };
    pointerRef.current = clamped;
    setPointer(clamped);
  }, []);

  /** Container coords → canvas coords. */
  const toCanvas = useCallback((pageX: number, pageY: number) => {
    const currentBox = boxRef.current;
    const currentFit = fitRef.current;
    if (!currentBox) {
      return { x: 0, y: 0 };
    }
    const cx = pageX - containerOrigin.current.x;
    const cy = pageY - containerOrigin.current.y;
    const s = scaleRef.current;
    const o = offsetRef.current;
    return {
      x: (cx - (currentBox.width / 2 + o.x)) / s + currentFit.w / 2,
      y: (cy - (currentBox.height / 2 + o.y)) / s + currentFit.h / 2,
    };
  }, []);

  /** Canvas coords → (x%, y%) of the plan. */
  const toPercentage = useCallback((point: { x: number; y: number }) => {
    const currentFit = fitRef.current;
    if (currentFit.w <= 0 || currentFit.h <= 0) {
      return null;
    }
    return {
      x: clamp((point.x / currentFit.w) * 100, 0, 100),
      y: clamp((point.y / currentFit.h) * 100, 0, 100),
    };
  }, []);

  /** Zooms keeping the given container point under the fingers. */
  const zoomAround = useCallback(
    (focalX: number, focalY: number, targetScale: number) => {
      const currentBox = boxRef.current;
      const currentFit = fitRef.current;
      if (!currentBox) {
        return;
      }
      const s = scaleRef.current;
      const o = offsetRef.current;
      const nextScale = clamp(targetScale, MIN_SCALE, MAX_SCALE);
      const u = {
        x: (focalX - (currentBox.width / 2 + o.x)) / s + currentFit.w / 2,
        y: (focalY - (currentBox.height / 2 + o.y)) / s + currentFit.h / 2,
      };
      const centerX = focalX - (u.x - currentFit.w / 2) * nextScale;
      const centerY = focalY - (u.y - currentFit.h / 2) * nextScale;
      const nextOffset = clampOffset(
        centerX - currentBox.width / 2,
        centerY - currentBox.height / 2,
        nextScale,
      );
      applyTransform(nextScale, nextOffset);
    },
    [applyTransform, clampOffset],
  );

  const resetView = useCallback(() => {
    applyTransform(MIN_SCALE, { x: 0, y: 0 });
  }, [applyTransform]);

  /** Momentum after a pan/fling, decaying until it stops. */
  const startMomentum = useCallback(
    (velocityX: number, velocityY: number) => {
      let vx = velocityX * 14;
      let vy = velocityY * 14;
      const step = () => {
        vx *= 0.92;
        vy *= 0.92;
        if (Math.abs(vx) < 0.4 && Math.abs(vy) < 0.4) {
          momentumRef.current = null;
          return;
        }
        const next = clampOffset(
          offsetRef.current.x + vx,
          offsetRef.current.y + vy,
          scaleRef.current,
        );
        offsetRef.current = next;
        offsetAnim.setValue(next);
        momentumRef.current = requestAnimationFrame(step);
      };
      momentumRef.current = requestAnimationFrame(step);
    },
    [clampOffset, offsetAnim],
  );

  const stopMomentum = useCallback(() => {
    if (momentumRef.current !== null) {
      cancelAnimationFrame(momentumRef.current);
      momentumRef.current = null;
    }
  }, []);

  // ------------------------------------------------------------------ data
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
      if (!planId) {
        return;
      }
      // Offline first: a plan opened before shows instantly, even without network.
      const localCopy = await localPlanUri(planId).catch(() => null);
      if (mounted && localCopy) {
        setImageUri(localCopy);
        setOfflineImage(true);
      }
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const data = await api.getPlan(token, planId);
        if (!mounted) {
          return;
        }
        setPlan(data);
        setError(null);
        if (!localCopy && data.planKind === 'IMAGE') {
          setImageUri(data.fileUrl);
        }
        void cachePlan(data).then(async () => {
          const cached = await localPlanUri(planId).catch(() => null);
          if (mounted && cached) {
            setImageUri((current) => current ?? cached);
          }
        });
      } catch (err) {
        if (!mounted) {
          return;
        }
        const cached = await localPlanUri(planId).catch(() => null);
        if (cached) {
          setOfflineImage(true);
        } else {
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

  // Thumbnails for pending pins (offline anchors): they only exist locally.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const next: Record<string, { uri: string | null; capturedAt: string }> = {};
      for (const pin of localPins) {
        const photo = await getLocalPhoto(pin.photoId).catch(() => null);
        if (photo) {
          next[pin.id] = {
            uri: photo.thumbnailUri ?? photo.localUri,
            capturedAt: photo.capturedAt,
          };
        }
      }
      if (mounted) {
        setLocalThumbs(next);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [localPins]);

  const measureContainer = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      containerOrigin.current = { x, y };
    });
  }, []);

  // -------------------------------------------------------------- gestures
  // Transient gesture state lives in refs: the PanResponder callbacks run
  // outside React, so they must not depend on render-scoped values.
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const tap = useRef<{ x: number; y: number; time: number; moved: number } | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        stopMomentum();
        setSelected(null);
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          pinch.current = {
            distance: Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            ),
            scale: scaleRef.current,
          };
          dragGrab.current = null;
        } else if (placingRef.current) {
          // Grab the pointer so it never jumps when the drag starts.
          dragGrab.current = {
            pointer: { ...pointerRef.current },
            touch: toCanvas(evt.nativeEvent.pageX, evt.nativeEvent.pageY),
          };
        }
        tap.current = {
          x: evt.nativeEvent.pageX,
          y: evt.nativeEvent.pageY,
          time: Date.now(),
          moved: 0,
        };
      },
      onPanResponderMove: (evt, gesture) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          if (!pinch.current) {
            pinch.current = {
              distance: Math.hypot(
                touches[0].pageX - touches[1].pageX,
                touches[0].pageY - touches[1].pageY,
              ),
              scale: scaleRef.current,
            };
            return;
          }
          const distance = Math.hypot(
            touches[0].pageX - touches[1].pageX,
            touches[0].pageY - touches[1].pageY,
          );
          const currentBox = boxRef.current;
          if (!currentBox) {
            return;
          }
          const focalX = (touches[0].pageX + touches[1].pageX) / 2 - containerOrigin.current.x;
          const focalY = (touches[0].pageY + touches[1].pageY) / 2 - containerOrigin.current.y;
          zoomAround(
            focalX,
            focalY,
            pinch.current.scale * (distance / Math.max(1, pinch.current.distance)),
          );
          if (tap.current) {
            tap.current.moved += Math.abs(gesture.dx) + Math.abs(gesture.dy);
          }
          return;
        }
        if (tap.current) {
          tap.current.moved += Math.abs(gesture.dx) + Math.abs(gesture.dy);
        }
        if (placingRef.current) {
          const grab = dragGrab.current;
          if (grab) {
            const touch = toCanvas(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            setPointerAt({
              x: grab.pointer.x + (touch.x - grab.touch.x),
              y: grab.pointer.y + (touch.y - grab.touch.y),
            });
          }
          return;
        }
        if (scaleRef.current > MIN_SCALE) {
          const next = clampOffset(
            offsetRef.current.x + gesture.dx,
            offsetRef.current.y + gesture.dy,
            scaleRef.current,
          );
          offsetRef.current = next;
          offsetAnim.setValue(next);
        }
      },
      onPanResponderRelease: (evt, gesture) => {
        pinch.current = null;
        dragGrab.current = null;
        const start = tap.current;
        tap.current = null;
        if (!start) {
          return;
        }
        const moved = start.moved;
        const duration = Date.now() - start.time;
        const isTap = moved < 12 && duration < 350;
        if (!isTap) {
          if (!placingRef.current && scaleRef.current > MIN_SCALE) {
            startMomentum(gesture.vx, gesture.vy);
          }
          return;
        }
        const now = Date.now();
        const currentBox = boxRef.current;
        const focalX = evt.nativeEvent.pageX - containerOrigin.current.x;
        const focalY = evt.nativeEvent.pageY - containerOrigin.current.y;
        if (now - lastTap.current < 300 && currentBox) {
          // Double tap → zoom in on the tapped point (or back to fit).
          lastTap.current = 0;
          if (scaleRef.current > MIN_SCALE + 0.01) {
            resetView();
          } else {
            zoomAround(focalX, focalY, 2.5);
          }
          return;
        }
        lastTap.current = now;
        if (placingRef.current) {
          setPointerAt(toCanvas(evt.nativeEvent.pageX, evt.nativeEvent.pageY));
          return;
        }
        // Generous hit area: a tap near a marker selects the closest one, so a
        // zoomed-in plan no longer needs pixel-perfect aiming.
        const tapped = toPercentage(toCanvas(evt.nativeEvent.pageX, evt.nativeEvent.pageY));
        if (!tapped) {
          return;
        }
        const currentFit = fitRef.current;
        const s = scaleRef.current;
        let best: DrawnPin | null = null;
        let bestDistance = Infinity;
        for (const pin of drawnPinsRef.current) {
          const dx = ((pin.x - tapped.x) / 100) * currentFit.w * s;
          const dy = ((pin.y - tapped.y) / 100) * currentFit.h * s;
          const distance = Math.hypot(dx, dy);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = pin;
          }
        }
        if (best && bestDistance <= TAP_TOLERANCE) {
          setSelected(best);
        } else {
          setSelected(null); // tapping empty space dismisses the card
        }
      },
      onPanResponderTerminate: () => {
        pinch.current = null;
        dragGrab.current = null;
        tap.current = null;
      },
    }),
  ).current;

  // --------------------------------------------------------------- actions
  const startPlacing = () => {
    const currentFit = fitRef.current;
    setPointerAt({ x: currentFit.w / 2, y: currentFit.h / 2 });
    setPlacing(true);
  };

  const cancelPlacing = () => {
    setPlacing(false);
    setSelected(null);
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
    // The anchor is kept: after shooting, pick the new photo from the grid.
    router.push({ pathname: '/capture', params: { projectId: plan.projectId } });
  };

  // Coming back from the camera with the picker open: refresh the photo grid so
  // the freshly captured photo can be anchored without reopening the flow.
  useFocusEffect(
    useCallback(() => {
      if (pickerOpen) {
        void openPhotoPicker();
      }
    }, [pickerOpen]),
  );

  const anchorPhoto = async (photoId: string) => {
    if (!planId) {
      return;
    }
    const pct = toPercentage(pointerRef.current);
    if (!pct) {
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
        xPercentage: pct.x,
        yPercentage: pct.y,
      });
      await enqueueSync('pin', id, {
        planId,
        photoId,
        pageNumber: 1,
        x: pct.x,
        y: pct.y,
      });
      if (token && online) {
        try {
          await api.createPin(token, {
            id,
            planId,
            photoId,
            pageNumber: 1,
            xPercentage: pct.x,
            yPercentage: pct.y,
          });
          await markPinSynced(id, new Date().toISOString());
        } catch {
          // The queue handles it (FIFO after the photo uploads).
        }
      }
      setPickerOpen(false);
      setPlacing(false);
      setSelected(null);
      void loadPins();
    } catch (err) {
      Alert.alert('No se pudo anclar', errorMessage(err));
    } finally {
      setSavingPin(false);
    }
  };

  const detachPin = async (pin: DrawnPin) => {
    await removeLocalPin(pin.id);
    await enqueueSync('pin_remove', pin.id, { pinId: pin.id });
    if (pin.pending) {
      // Never uploaded: drop the pending create so the server sees nothing.
      await dropQueuedEntityOps(pin.id, 'pin');
    }
    if (token && online && !pin.pending) {
      try {
        await api.removePin(token, pin.id);
        await dropQueuedEntityOps(pin.id, 'pin_remove');
      } catch {
        // The queue retries (404 = already gone = success).
      }
    }
    setSelected(null);
    void loadPins();
  };

  const confirmDetach = (pin: DrawnPin) => {
    Alert.alert(
      'Quitar del plano',
      'La foto se mantiene en la galería; solo se quita la marca del plano.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => void detachPin(pin) },
      ],
    );
  };

  // ----------------------------------------------------------- derived data
  const drawnPins = useMemo<DrawnPin[]>(() => {
    const syncedIds = new Set(serverPins.map((p) => p.id));
    const synced: DrawnPin[] = serverPins.map((p) => ({
      id: p.id,
      photoId: p.photoId,
      x: p.xPercentage,
      y: p.yPercentage,
      pending: false,
      thumbnailUri: p.photo?.thumbnailUrl ?? null,
      capturedAt: p.photo?.capturedAt ?? null,
    }));
    const pending: DrawnPin[] = localPins
      .filter((lp) => !syncedIds.has(lp.id) && lp.syncedAt == null)
      .map((lp) => ({
        id: lp.id,
        photoId: lp.photoId,
        x: lp.xPercentage,
        y: lp.yPercentage,
        pending: true,
        thumbnailUri: localThumbs[lp.id]?.uri ?? null,
        capturedAt: localThumbs[lp.id]?.capturedAt ?? null,
      }));
    return [...synced, ...pending];
  }, [serverPins, localPins, localThumbs]);

  const pendingCount = drawnPins.filter((p) => p.pending).length;
  const pointerPct = toPercentage(pointer);

  useEffect(() => {
    drawnPinsRef.current = drawnPins;
  }, [drawnPins]);

  if (loading) {
    return (
      <View style={styles.full}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if ((!plan && !offlineImage) || (error && !imageUri)) {
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

  const isPdf = plan?.planKind === 'PDF' && !imageUri;

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Cerrar plano"
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {plan?.title ?? 'Plano'}
        </Text>
        <Pressable
          onPress={() =>
            plan
              ? router.push({
                  pathname: '/plan-photos',
                  params: { planId: plan.id, planTitle: plan.title },
                })
              : undefined
          }
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Ver fotos del plano"
        >
          <Text style={styles.iconGlyph}>📋</Text>
        </Pressable>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{drawnPins.length} 📍</Text>
        </View>
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
            setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
            measureContainer();
          }}
          {...panResponder.panHandlers}
        >
          {box && imageUri ? (
            <Animated.View
              style={[
                styles.canvas,
                {
                  width: fit.w,
                  height: fit.h,
                  transform: [
                    { translateX: offsetAnim.x },
                    { translateY: offsetAnim.y },
                    { scale: scaleAnim },
                  ],
                },
              ]}
            >
              <Image
                source={{ uri: imageUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
                onLoad={(e) => {
                  const { width, height } = e.nativeEvent.source;
                  if (width > 0 && height > 0 && aspectRef.current === 0) {
                    setAspect(width / height);
                  }
                  setImageLoading(false);
                }}
                onError={() => {
                  setImageLoading(false);
                  if (!offlineImage) {
                    setError('No se pudo cargar el plano. Reintenta (la URL pudo expirar).');
                  }
                }}
              />

              {/* Placement pointer */}
              {placing ? (
                <Animated.View
                  style={[
                    styles.pointerWrap,
                    {
                      left: pointer.x - MARKER_SIZE,
                      top: pointer.y - MARKER_SIZE,
                      transform: [{ scale: pinScale }],
                    },
                  ]}
                  pointerEvents="none"
                >
                  <View style={styles.pointerRing} />
                  <View style={styles.pointerDot} />
                </Animated.View>
              ) : null}
            </Animated.View>
          ) : null}

          {!imageUri || imageLoading ? (
            <View style={styles.canvasLoader} pointerEvents="none">
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.canvasLoaderText}>Cargando plano…</Text>
            </View>
          ) : null}

          {/*
           * Anchored photos, drawn OUTSIDE the zoomed canvas so the marker and
           * its touch area keep a constant size on screen (a counter-scaled
           * marker inside the canvas shrank to a few pixels when zooming in).
           */}
          <View style={StyleSheet.absoluteFill} pointerEvents={placing ? 'none' : 'box-none'}>
            {box
              ? drawnPins.map((pin) => (
                  <Marker
                    key={pin.id}
                    pin={pin}
                    boxWidth={box.width}
                    boxHeight={box.height}
                    fitWidth={fit.w}
                    fitHeight={fit.h}
                    selected={selected?.id === pin.id}
                    scaleAnim={scaleAnim}
                    offsetAnim={offsetAnim}
                    onSelect={setSelected}
                  />
                ))
              : null}
          </View>

          {/* Zoom controls */}
          <View style={styles.zoomControls}>
            <Pressable
              onPress={() =>
                zoomAround((box?.width ?? 0) / 2, (box?.height ?? 0) / 2, scaleRef.current * 1.5)
              }
              style={styles.zoomButton}
              accessibilityRole="button"
              accessibilityLabel="Acercar"
            >
              <Text style={styles.zoomGlyph}>＋</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                zoomAround((box?.width ?? 0) / 2, (box?.height ?? 0) / 2, scaleRef.current / 1.5)
              }
              style={styles.zoomButton}
              accessibilityRole="button"
              accessibilityLabel="Alejar"
            >
              <Text style={styles.zoomGlyph}>－</Text>
            </Pressable>
            <Pressable
              onPress={resetView}
              style={styles.zoomButton}
              accessibilityRole="button"
              accessibilityLabel="Centrar plano"
            >
              <Text style={styles.zoomGlyph}>⤢</Text>
            </Pressable>
          </View>

          {offlineImage ? (
            <View style={styles.offlinePill}>
              <Text style={styles.offlinePillText}>✈️ Plano guardado en el equipo</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Bottom bar: explicit anchoring flow */}
      <View style={styles.bottomBar}>
        {placing ? (
          <>
            <Text style={styles.placeHint}>
              Arrastra el puntero al punto exacto, o toca el plano. Pellizca con dos dedos para
              acercar.
            </Text>
            <Text style={styles.placeCoords}>
              {pointerPct ? `x ${pointerPct.x.toFixed(1)}%  ·  y ${pointerPct.y.toFixed(1)}%` : ''}
            </Text>
            <View style={styles.placeActions}>
              <Pressable
                onPress={cancelPlacing}
                style={[styles.placeButton, styles.placeButtonGhost]}
                accessibilityRole="button"
              >
                <Text style={styles.placeButtonGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={() => void openPhotoPicker()}
                disabled={photoPickerBusy}
                style={[styles.placeButton, styles.placeButtonPrimary]}
                accessibilityRole="button"
              >
                <Text style={styles.placeButtonPrimaryText}>
                  {photoPickerBusy ? 'Abriendo…' : 'Fijar aquí'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.bottomActions}>
              <Pressable
                onPress={startPlacing}
                style={styles.addButton}
                accessibilityRole="button"
                accessibilityLabel="Añadir foto al plano"
              >
                <Text style={styles.addButtonGlyph}>＋</Text>
                <Text style={styles.addButtonText}>Añadir foto al plano</Text>
              </Pressable>
              <Pressable
                onPress={() => setListOpen(true)}
                disabled={drawnPins.length === 0}
                style={[styles.listButton, drawnPins.length === 0 && styles.listButtonDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`Ver las ${drawnPins.length} fotos ancladas`}
              >
                <Text style={styles.listButtonGlyph}>📍</Text>
                <Text style={styles.listButtonText}>{drawnPins.length}</Text>
              </Pressable>
            </View>
            <Text style={styles.bottomHint}>
              {drawnPins.length === 0
                ? 'Aún no hay fotos ancladas en este plano.'
                : pendingCount > 0
                  ? `${drawnPins.length} anclada(s) · ${pendingCount} por sincronizar`
                  : 'Toca una marca o usa 📍 para ver las fotos ancladas.'}
            </Text>
          </>
        )}
      </View>

      {/* Pin preview card */}
      <Modal
        visible={selected !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable style={styles.previewOverlay} onPress={() => setSelected(null)}>
          <Pressable style={styles.previewCard} onPress={() => undefined}>
            {selected ? (
              <>
                <View style={styles.previewRow}>
                  {selected.thumbnailUri ? (
                    <ExpoImage
                      source={selected.thumbnailUri}
                      style={styles.previewThumb}
                      contentFit="cover"
                      transition={120}
                    />
                  ) : (
                    <View style={[styles.previewThumb, styles.previewThumbEmpty]}>
                      <Text style={styles.previewThumbGlyph}>📷</Text>
                    </View>
                  )}
                  <View style={styles.previewInfo}>
                    <Text style={styles.previewTitle}>
                      {selected.pending ? 'Anclaje pendiente' : 'Foto anclada'}
                    </Text>
                    <Text style={styles.previewMeta}>
                      {formatDateTime(selected.capturedAt) ||
                        `${selected.x.toFixed(1)}% · ${selected.y.toFixed(1)}%`}
                    </Text>
                    {selected.pending ? (
                      <Text style={styles.previewPending}>Se subirá al recuperar conexión.</Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.previewActions}>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/media-viewer',
                        params: selected.pending
                          ? { mediaId: selected.photoId }
                          : { remoteId: selected.photoId },
                      })
                    }
                    style={[styles.previewButton, styles.previewButtonPrimary]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.previewButtonPrimaryText}>Abrir foto</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDetach(selected)}
                    style={[styles.previewButton, styles.previewButtonDanger]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.previewButtonDangerText}>Quitar del plano</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Anchored photos list — pick one without aiming at the map */}
      <Modal
        visible={listOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setListOpen(false)}
      >
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, styles.listSheet]}>
            <View style={styles.sheetGrabber} />
            <Text style={styles.sheetTitle}>Fotos ancladas ({drawnPins.length})</Text>
            <Text style={styles.sheetHint}>
              Toca una para verla o quitarla del plano. Las ámbar están pendientes de subir.
            </Text>
            <FlatList
              data={drawnPins}
              keyExtractor={(item) => item.id}
              style={styles.listBody}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setListOpen(false);
                    setSelected(item);
                  }}
                  style={styles.pinRow}
                  accessibilityRole="button"
                >
                  {item.thumbnailUri ? (
                    <ExpoImage
                      source={item.thumbnailUri}
                      style={styles.pinRowThumb}
                      contentFit="cover"
                      recyclingKey={item.id}
                    />
                  ) : (
                    <View style={[styles.pinRowThumb, styles.previewThumbEmpty]}>
                      <Text style={styles.previewThumbGlyph}>📷</Text>
                    </View>
                  )}
                  <View style={styles.pinRowInfo}>
                    <Text style={styles.pinRowTitle}>
                      {item.pending ? '⏫ Pendiente de subir' : 'Foto anclada'}
                    </Text>
                    <Text style={styles.pinRowMeta}>
                      {formatDateTime(item.capturedAt)}
                      {item.capturedAt ? ' · ' : ''}x {item.x.toFixed(1)}% · y {item.y.toFixed(1)}%
                    </Text>
                  </View>
                  <Text style={styles.pinRowChevron}>›</Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyMedia}>Aún no hay fotos ancladas en este plano.</Text>
              }
            />
            <Pressable
              onPress={() => setListOpen(false)}
              style={styles.cancel}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Photo picker (after fixing the point) */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.sheetOverlay}>
          <View style={[styles.sheet, styles.pickerSheet]}>
            <View style={styles.sheetGrabber} />
            <Text style={styles.sheetTitle}>Elige la foto de este punto</Text>
            <Text style={styles.sheetHint}>
              {pointerPct
                ? `Posición x ${pointerPct.x.toFixed(1)}% · y ${pointerPct.y.toFixed(1)}%`
                : ''}
              {savingPin ? ' · anclando…' : ''}
            </Text>
            <Pressable
              onPress={takeNow}
              style={styles.takeButton}
              accessibilityRole="button"
              disabled={savingPin}
            >
              <Text style={styles.takeButtonGlyph}>📷</Text>
              <View style={styles.takeButtonTextWrap}>
                <Text style={styles.takeButtonTitle}>Tomar foto ahora</Text>
                <Text style={styles.takeButtonSub}>Vuelve aquí y elige la foto nueva</Text>
              </View>
            </Pressable>
            <FlatList
              data={localMedia}
              keyExtractor={(item) => item.id}
              numColumns={3}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => void anchorPhoto(item.id)}
                  disabled={savingPin}
                  style={styles.mediaTile}
                  accessibilityRole="button"
                >
                  {item.localUri ? (
                    <ExpoImage
                      source={item.localUri}
                      style={styles.mediaThumb}
                      contentFit="cover"
                      recyclingKey={item.id}
                    />
                  ) : (
                    <View style={[styles.mediaThumb, styles.mediaPlaceholder]}>
                      <Text style={styles.mediaGlyph}>{item.kind === 'VIDEO' ? '▶' : '📷'}</Text>
                    </View>
                  )}
                  {item.kind === 'VIDEO' ? (
                    <View style={styles.mediaTileStatus}>
                      <Text style={styles.mediaTileIcon}>🎥</Text>
                    </View>
                  ) : null}
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
  container: { flex: 1, backgroundColor: '#05070E' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(8,12,24,0.6)',
  },
  topTitle: {
    flex: 1,
    fontFamily: fonts.display,
    color: '#FFFFFF',
    fontSize: 16.5,
    marginHorizontal: 4,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#FFFFFF', fontSize: 16 },
  iconGlyph: { fontSize: 16 },
  countPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  countText: { fontFamily: fonts.sansBold, color: colors.accent, fontSize: 12.5 },

  imageArea: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  canvas: { alignItems: 'center', justifyContent: 'center' },
  canvasLoader: { position: 'absolute', alignItems: 'center', gap: 10 },
  canvasLoaderText: { fontFamily: fonts.sansMedium, color: '#D7DEEC', fontSize: 13 },

  pinWrap: { position: 'absolute', width: PIN_VISUAL, height: PIN_VISUAL },
  markerWrap: { position: 'absolute', width: MARKER_SIZE, height: MARKER_SIZE },
  markerPress: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBody: {
    width: PIN_VISUAL,
    height: PIN_VISUAL,
    borderRadius: PIN_VISUAL / 2,
    backgroundColor: colors.danger,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pinBodyPending: { backgroundColor: colors.accent },
  pinBodySelected: { borderColor: colors.accent, borderWidth: 3.5 },
  pinGlyph: { fontSize: 13 },

  pointerWrap: {
    position: 'absolute',
    width: MARKER_SIZE * 2,
    height: MARKER_SIZE * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointerRing: {
    position: 'absolute',
    width: MARKER_SIZE * 2,
    height: MARKER_SIZE * 2,
    borderRadius: MARKER_SIZE,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'rgba(245,158,11,0.16)',
  },
  pointerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },

  zoomControls: { position: 'absolute', right: 14, bottom: 22, gap: 8 },
  zoomButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(8,12,24,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomGlyph: { color: '#FFFFFF', fontSize: 19, fontFamily: fonts.sansMedium },
  offlinePill: {
    position: 'absolute',
    top: 108,
    alignSelf: 'center',
    backgroundColor: 'rgba(8,12,24,0.7)',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  offlinePillText: { fontFamily: fonts.sansSemiBold, color: colors.accent, fontSize: 11.5 },

  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: 'rgba(8,12,24,0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  bottomActions: { flexDirection: 'row', gap: 10 },
  addButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  listButton: {
    width: 72,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 1,
  },
  listButtonDisabled: { opacity: 0.45 },
  listButtonGlyph: { fontSize: 14 },
  listButtonText: { fontFamily: fonts.sansBold, color: '#FFFFFF', fontSize: 13 },

  listSheet: { height: '76%' },
  listBody: { flex: 1, marginTop: 12 },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 10,
    marginBottom: 8,
  },
  pinRowThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  pinRowInfo: { flex: 1, gap: 2 },
  pinRowTitle: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.ink },
  pinRowMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.textMuted },
  pinRowChevron: { fontFamily: fonts.sansBold, fontSize: 18, color: colors.textFaint },
  addButtonGlyph: { color: '#FFFFFF', fontSize: 20, fontFamily: fonts.sansMedium, marginTop: -2 },
  addButtonText: { fontFamily: fonts.sansBold, color: '#FFFFFF', fontSize: 15.5 },
  bottomHint: {
    fontFamily: fonts.sans,
    color: '#94A3B8',
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: 8,
  },
  placeHint: { fontFamily: fonts.sans, color: '#D7DEEC', fontSize: 12.5, lineHeight: 18 },
  placeCoords: {
    fontFamily: fonts.displayMedium,
    color: colors.accent,
    fontSize: 13,
    marginTop: 6,
  },
  placeActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  placeButton: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeButtonGhost: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  placeButtonGhostText: { fontFamily: fonts.sansBold, color: '#E2E8F0', fontSize: 14.5 },
  placeButtonPrimary: { backgroundColor: colors.accent },
  placeButtonPrimaryText: { fontFamily: fonts.sansBold, color: '#1F1300', fontSize: 15 },

  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4,8,18,0.6)',
    justifyContent: 'flex-end',
    padding: 16,
    paddingBottom: 30,
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    gap: 14,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  previewThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  previewThumbGlyph: { fontSize: 22 },
  previewInfo: { flex: 1, gap: 3 },
  previewTitle: { fontFamily: fonts.display, fontSize: 16, color: colors.ink },
  previewMeta: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.textMuted },
  previewPending: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.accentInk },
  previewActions: { flexDirection: 'row', gap: 10 },
  previewButton: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewButtonPrimary: { backgroundColor: colors.primary },
  previewButtonPrimaryText: { fontFamily: fonts.sansBold, color: '#FFFFFF', fontSize: 14.5 },
  previewButtonDanger: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  previewButtonDangerText: { fontFamily: fonts.sansBold, color: colors.danger, fontSize: 14.5 },

  sheetOverlay: { flex: 1, backgroundColor: 'rgba(4,8,18,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 34,
  },
  pickerSheet: { height: '78%' },
  sheetGrabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 14,
  },
  sheetTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  sheetHint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 6,
    lineHeight: 19,
  },
  takeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    marginBottom: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    padding: 14,
  },
  takeButtonGlyph: { fontSize: 22 },
  takeButtonTextWrap: { flex: 1 },
  takeButtonTitle: { fontFamily: fonts.display, fontSize: 15.5, color: colors.ink },
  takeButtonSub: { fontFamily: fonts.sans, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  mediaTile: { flex: 1 / 3, aspectRatio: 1, padding: 3 },
  mediaThumb: { width: '100%', height: '100%', borderRadius: 10 },
  mediaPlaceholder: { backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  mediaGlyph: { fontSize: 20, color: 'rgba(255,255,255,0.75)' },
  mediaTileStatus: { position: 'absolute', bottom: 6, left: 6 },
  mediaTileIcon: { fontSize: 12 },
  emptyMedia: {
    fontFamily: fonts.sans,
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingTop: 24,
  },
  cancel: { alignItems: 'center', marginTop: 14 },
  cancelText: { fontFamily: fonts.sansSemiBold, color: colors.textMuted, fontSize: 14 },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  backText: { fontFamily: fonts.sansBold, color: '#FFFFFF' },
  errorText: {
    fontFamily: fonts.sans,
    color: '#E2E8F0',
    fontSize: 15,
    textAlign: 'center',
    marginHorizontal: 24,
  },
  pdfHint: {
    fontFamily: fonts.sans,
    color: '#E2E8F0',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginHorizontal: 28,
  },
});

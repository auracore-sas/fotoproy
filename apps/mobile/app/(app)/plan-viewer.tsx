import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';
import type { Plan } from '../../lib/types';

interface Size {
  width: number;
  height: number;
}

/**
 * Fullscreen plan viewer (F3.2). Image plans only for now (PDF arrives with
 * the WebView/pdf.js spike). Pinch / double-tap to zoom; drag to pan while
 * zoomed. The coordinates plumbing for anchoring photos (F3.3) will be added
 * on top of this screen.
 */
export default function PlanViewerScreen() {
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { token } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const tapStart = useRef<{ x: number; y: number; time: number } | null>(null);

  const apply = useCallback((nextScale: number, nextOffset?: { x: number; y: number }) => {
    const clampedScale = Math.min(5, Math.max(1, nextScale));
    scaleRef.current = clampedScale;
    if (nextOffset) {
      offsetRef.current = nextOffset;
    }
    setScale(clampedScale);
    setOffset({ ...offsetRef.current });
  }, []);

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
          // Drag to pan while zoomed.
          const limit = 400; // loose bound keeps the image reachable
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
        // Tap = short press with little movement → double tap toggles zoom.
        if (start) {
          const moved = Math.hypot(
            evt.nativeEvent.pageX - start.x,
            evt.nativeEvent.pageY - start.y,
          );
          const duration = Date.now() - start.time;
          if (moved < 10 && duration < 300) {
            const now = Date.now();
            if (now - lastTap.current < 300) {
              apply(scaleRef.current > 1 ? 1 : 2.5, { x: 0, y: 0 });
              lastTap.current = 0;
            } else {
              lastTap.current = now;
            }
          }
        }
      },
      onPanResponderTerminate: () => {
        pinchStart.current = null;
        tapStart.current = null;
      },
    }),
  ).current;

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
          style={styles.imageArea}
          onLayout={(e) =>
            setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
          }
          {...panResponder.panHandlers}
        >
          {box ? (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ translateX: offset.x }, { translateY: offset.y }],
              }}
            >
              <Image
                source={{ uri: plan.fileUrl }}
                style={[styles.image, { width: box.width * scale, height: box.height * scale }]}
                resizeMode="contain"
                onError={() =>
                  setError('No se pudo cargar el plano. Reintenta más tarde (la URL pudo expirar).')
                }
              />
            </View>
          ) : (
            <ActivityIndicator size="large" color="#FFFFFF" />
          )}
        </View>
      )}
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
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  topTitle: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '600', marginLeft: 12 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  imageArea: { flex: 1, overflow: 'hidden' },
  image: { maxWidth: '100%', maxHeight: '100%' },
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
});

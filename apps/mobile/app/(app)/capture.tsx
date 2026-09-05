import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, Button } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage, useAuth } from '../../lib/auth';
import { createLocalPhoto, enqueueSync } from '../../lib/db';
import { generateId } from '../../lib/id';
import { persistCapturedMedia } from '../../lib/media';

type FlashMode = 'off' | 'auto' | 'on';
type CaptureMode = 'photo' | 'video';
type AspectRatio = '4:3' | '16:9' | '1:1';
type MediaKind = 'PHOTO' | 'VIDEO';

const RATIOS: AspectRatio[] = ['4:3', '16:9', '1:1'];
const MAX_VIDEO_SECONDS = 180;
/** Extra wait (ms) for a GPS fix right at shutter time before saving. */
const GPS_QUICK_TIMEOUT_MS = 1200;
/** Background search timeout (ms) per attempt when there is no fix yet. */
const GPS_SEEK_TIMEOUT_MS = 8000;

interface GpsCoords {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
}

interface GeoState extends GpsCoords {
  status: 'idle' | 'loading' | 'ready' | 'denied' | 'error';
}

function formatClock(date: Date): string {
  return date.toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function requestLocation(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

/** Distance between two touch points (screen coordinates). */
function touchDistance(
  a: { pageX: number; pageY: number },
  b: { pageX: number; pageY: number },
): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export default function CaptureScreen() {
  const router = useRouter();
  const { projectId, projectCode, projectName } = useLocalSearchParams<{
    projectId: string;
    projectCode?: string;
    projectName?: string;
  }>();
  const { user, token } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView | null>(null);

  // Project label for the stamp: from navigation params (offline) and then
  // refreshed from the server when connectivity allows.
  const [projectLabel, setProjectLabel] = useState<{ code: string; name: string } | null>(() =>
    projectCode && projectName ? { code: projectCode, name: projectName } : null,
  );
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [torch, setTorch] = useState(false);
  const [muted, setMuted] = useState(false); // shutter sound toggle (iOS)
  const [forceSilentVideo, setForceSilentVideo] = useState(false); // mic denied → video without audio
  const [ratio, setRatio] = useState<AspectRatio>('4:3');
  const [zoom, setZoom] = useState(0); // 0..1 mapped to the device zoom range
  const zoomRef = useRef(0);

  /** Clamps zoom to [0,1], keeps the ref in sync and updates the label. */
  const applyZoom = (next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    zoomRef.current = clamped;
    setZoom(clamped);
  };

  // Two-finger pinch: opening/closing the finger gap zooms in/out.
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartZoom = useRef(0);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 2,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          pinchStartDistance.current = touchDistance(touches[0], touches[1]);
          pinchStartZoom.current = zoomRef.current;
        }
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length !== 2 || pinchStartDistance.current == null) {
          return;
        }
        const distance = touchDistance(touches[0], touches[1]);
        const ratioGap = distance / pinchStartDistance.current;
        applyZoom(pinchStartZoom.current + (ratioGap - 1));
      },
      onPanResponderRelease: () => {
        pinchStartDistance.current = null;
      },
      onPanResponderTerminate: () => {
        pinchStartDistance.current = null;
      },
    }),
  ).current;

  const [now, setNow] = useState(new Date());
  const [geo, setGeo] = useState<GeoState>({
    status: 'idle',
    latitude: null,
    longitude: null,
    altitude: null,
  });
  const [taking, setTaking] = useState(false);
  const busyRef = useRef(false);

  // Recording state (video mode).
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const startedAtRef = useRef(0);

  // Session counters for light feedback while capturing.
  const [savedCount, setSavedCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live clock for the overlay stamp.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Recording timer.
  useEffect(() => {
    if (!recording) {
      return;
    }
    const interval = setInterval(() => {
      setRecordSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [recording]);

  // Load project info for the stamp.
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!token || !projectId) {
        return;
      }
      try {
        const data = await api.getProject(token, projectId);
        if (mounted) {
          setProjectLabel({ code: data.code, name: data.name });
        }
      } catch {
        // Non-fatal: capture works even if the project fetch fails.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token, projectId]);

  // Location permission + GPS fix loop (optional, NEVER blocks capture).
  // Tries to get a fix on mount and keeps retrying in the background every few
  // seconds until it succeeds — GPS does not need internet (satellite only),
  // but a cold fix indoors/offline can take a while.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const granted = await requestLocation();
      if (cancelled) {
        return;
      }
      if (!granted) {
        setGeo({ status: 'denied', latitude: null, longitude: null, altitude: null });
        return;
      }
      setGeo((g) => ({ ...g, status: 'loading' }));
      const attempt = async (): Promise<boolean> => {
        const fix = await grabFix(GPS_SEEK_TIMEOUT_MS);
        if (cancelled) {
          return true;
        }
        if (fix) {
          return true;
        }
        setGeo((g) =>
          g.latitude != null && g.longitude != null
            ? g // keep a previous fix if we ever had one
            : { status: 'error', latitude: null, longitude: null, altitude: null },
        );
        return false;
      };
      let done = await attempt();
      while (!done && !cancelled) {
        await new Promise((resolve) => setTimeout(resolve, GPS_SEEK_TIMEOUT_MS));
        done = await attempt();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Tries once to obtain a GPS fix within `timeoutMs`. Updates the live state
   * on success and returns the coordinates (or null). Used both by the
   * background loop and by the short “wait at shutter” attempt.
   */
  const grabFix = async (
    timeoutMs: number,
  ): Promise<{ latitude: number; longitude: number; altitude: number | null } | null> => {
    try {
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (!position) {
        return null;
      }
      const fix = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitude: position.coords.altitude ?? null,
      };
      setGeo({ status: 'ready', ...fix });
      return fix;
    } catch {
      return null;
    }
  };

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => setToast(null), 1400);
  };

  /** Persists a media item (photo/video) locally and enqueues sync. */
  const storeMedia = async (
    kind: MediaKind,
    sourceUri: string,
    capturedAt: string,
    coords: GpsCoords,
    durationMs?: number,
  ): Promise<void> => {
    try {
      const mediaId = generateId();
      const extension = kind === 'VIDEO' ? 'mp4' : 'jpg';
      const localUri = await persistCapturedMedia(sourceUri, mediaId, extension);
      const hasGps = coords.latitude != null && coords.longitude != null;
      await createLocalPhoto({
        id: mediaId,
        projectId,
        userId: user?.id ?? null,
        kind,
        durationMs: durationMs ?? null,
        localUri,
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: coords.altitude,
        capturedAt,
      });
      await enqueueSync('photo', mediaId, {
        id: mediaId,
        projectId,
        kind,
        durationMs: durationMs ?? null,
        capturedAt,
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: coords.altitude,
      });
      const count = savedCount + 1;
      setSavedCount(count);
      const label = kind === 'VIDEO' ? 'Video guardado' : 'Foto guardada';
      showToast(
        `✓ ${label}${count > 1 ? ` (${count})` : ''}${hasGps ? ' · 📍 con GPS' : ' · sin GPS'}`,
      );
    } catch (error) {
      Alert.alert('Error al guardar', errorMessage(error));
    }
  };

  /**
   * Coordinates for the media about to be saved: uses the current fix, or —
   * only when there is none yet and the permission exists — waits a short
   * moment for one so burst captures rarely end up without GPS.
   */
  const resolveGpsForShot = async (): Promise<GpsCoords> => {
    if (geo.status === 'ready' && geo.latitude != null) {
      return { latitude: geo.latitude, longitude: geo.longitude, altitude: geo.altitude };
    }
    if (geo.status === 'denied') {
      return { latitude: null, longitude: null, altitude: null };
    }
    const fix = await grabFix(GPS_QUICK_TIMEOUT_MS);
    if (fix) {
      return fix;
    }
    // Keep whatever partial state we have (usually nothing).
    return { latitude: geo.latitude, longitude: geo.longitude, altitude: geo.altitude };
  };

  /** Burst photo capture: saves automatically and keeps the camera active. */
  const takePhoto = async () => {
    if (!cameraRef.current || busyRef.current || recording) {
      return;
    }
    busyRef.current = true;
    setTaking(true);
    try {
      const result = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        shutterSound: !muted, // iOS honors this; Android follows the system volume
      });
      const coords = await resolveGpsForShot();
      await storeMedia('PHOTO', result.uri, new Date().toISOString(), coords);
    } catch {
      Alert.alert('Error', 'No se pudo capturar la foto. Intenta de nuevo.');
    } finally {
      setTaking(false);
      busyRef.current = false;
    }
  };

  const startVideo = async () => {
    if (!cameraRef.current || busyRef.current) {
      return;
    }

    // Video includes audio by default: ask for the microphone. If denied,
    // fall back to a silent recording instead of failing.
    const micResult = await requestMicPermission().catch(() => null);
    const silent = !(micResult?.granted ?? false);
    setForceSilentVideo(silent);
    if (silent) {
      showToast('Micrófono sin permiso: video sin audio');
    }

    busyRef.current = true;
    startedAtRef.current = Date.now();
    setRecordSeconds(0);
    // Warm up GPS while recording so the video usually saves with coordinates.
    void grabFix(GPS_SEEK_TIMEOUT_MS);
    const promise = cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
    recordPromiseRef.current = promise;
    setRecording(true);
    promise
      .then(async (result) => {
        if (!result) {
          setRecording(false);
          busyRef.current = false;
          return;
        }
        const durationMs = Date.now() - startedAtRef.current;
        setRecording(false);
        const coords = await resolveGpsForShot();
        await storeMedia(
          'VIDEO',
          result.uri,
          new Date(startedAtRef.current).toISOString(),
          coords,
          durationMs,
        );
      })
      .catch((error: unknown) => {
        setRecording(false);
        console.warn('Video recording failed:', error);
        Alert.alert('Error', 'No se pudo grabar el video. Intenta de nuevo.');
      })
      .finally(() => {
        busyRef.current = false;
      });
  };

  const stopVideo = () => {
    if (!recording) {
      return;
    }
    // Stops the recording; the pending promise resolves and saves the video.
    cameraRef.current?.stopRecording();
  };

  const cycleRatio = () => {
    setRatio((current) => RATIOS[(RATIOS.indexOf(current) + 1) % RATIOS.length]);
  };

  const projectLine = projectLabel
    ? `${projectLabel.code} · ${projectLabel.name}`
    : 'Cargando proyecto…';
  const zoomFactor = 1 + zoom * 3; // approximate visual multiplier for the label
  const gpsReady = geo.status === 'ready' && geo.latitude != null && geo.longitude != null;
  const gpsLine = gpsReady
    ? `📍 ${geo.latitude!.toFixed(6)}, ${geo.longitude!.toFixed(6)}` +
      (geo.altitude != null ? ` · ${Math.round(geo.altitude)} m` : '')
    : geo.status === 'denied'
      ? '📍 Ubicación sin permiso'
      : geo.status === 'error'
        ? '📍 GPS sin señal'
        : '📍 Buscando señal GPS…';
  const gpsHint = gpsReady
    ? null
    : geo.status === 'denied'
      ? 'Las fotos se guardarán sin coordenadas hasta que actives la ubicación en ajustes.'
      : geo.status === 'error'
        ? 'La foto se guardará igual, pero sin coordenadas hasta que haya señal GPS.'
        : 'Puedes capturar igual: al disparar se intenta por un instante.';
  const signer = (user?.signature ?? '').trim() || (user?.fullName ?? '');
  const stampLines = [`🏗️ ${projectLine}`, `👤 ${signer}`, gpsLine];
  const formatTimer = `${String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:${String(
    recordSeconds % 60,
  ).padStart(2, '0')}`;

  // Camera permission loading.
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Camera permission denied.
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>Se necesita la cámara</Text>
        <Text style={styles.permissionText}>
          FotoProy usa la cámara para documentar el avance de tu obra.
        </Text>
        <View style={styles.permissionActions}>
          <Button title="Permitir cámara" onPress={requestPermission} />
          <View style={{ height: 10 }} />
          <Button
            title="Abrir ajustes"
            variant="secondary"
            onPress={() => Linking.openSettings()}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode={mode === 'photo' ? 'picture' : 'video'}
        flash={flash}
        enableTorch={torch}
        mute={forceSilentVideo}
        ratio={ratio}
        zoom={zoom}
        onMountError={() => Alert.alert('Error', 'No se pudo iniciar la cámara.')}
      />

      {/* Pinch-to-zoom capture layer (under the UI controls). */}
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} />

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Cerrar cámara"
        >
          <Text style={styles.iconText}>✕</Text>
        </Pressable>
        <Text style={styles.topTitle}>{projectLabel ? projectLabel.code : 'Captura'}</Text>
        <View style={styles.topRight}>
          <Pressable
            onPress={() => setTorch((t) => !t)}
            style={[styles.iconButton, torch && styles.torchOn]}
            accessibilityRole="button"
            accessibilityLabel="Alternar linterna"
          >
            <Text style={styles.iconText}>🔦</Text>
          </Pressable>
          <Pressable
            onPress={() => setMuted((m) => !m)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Alternar sonido del obturador"
          >
            <Text style={styles.iconText}>{muted ? '🔇' : '🔊'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setFlash((f) => (f === 'off' ? 'auto' : f === 'auto' ? 'on' : 'off'))}
            style={[styles.iconButton, styles.flashButton]}
            accessibilityRole="button"
            accessibilityLabel="Alternar flash"
          >
            <Text style={[styles.iconText, styles.flashLabel]}>
              {flash === 'off' ? '⚡OFF' : flash === 'auto' ? '⚡AUTO' : '⚡ON'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Mode switch (photo/video) */}
      <View style={styles.modeBar}>
        <Pressable
          onPress={() => setMode('photo')}
          style={[styles.modeChip, mode === 'photo' && styles.modeChipActive]}
          accessibilityRole="button"
        >
          <Text style={[styles.modeChipText, mode === 'photo' && styles.modeChipTextActive]}>
            📷 Foto
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('video')}
          style={[styles.modeChip, mode === 'video' && styles.modeChipActive]}
          accessibilityRole="button"
        >
          <Text style={[styles.modeChipText, mode === 'video' && styles.modeChipTextActive]}>
            🎥 Video
          </Text>
        </Pressable>
      </View>

      {/* Live stamp overlay */}
      <View style={styles.stampOverlay} pointerEvents="none">
        <Text style={styles.stampTitle}>
          {mode === 'video' && recording ? `🔴 REC ${formatTimer}` : `📷 ${formatClock(now)}`}
        </Text>
        {stampLines.map((line, i) => (
          <Text key={i} style={styles.stampLine}>
            {line}
          </Text>
        ))}
        {gpsHint ? <Text style={styles.stampHint}>{gpsHint}</Text> : null}
      </View>

      {/* Aspect ratio control (left) */}
      <View style={styles.ratioControl}>
        <Pressable
          onPress={cycleRatio}
          style={styles.ratioChip}
          accessibilityRole="button"
          accessibilityLabel="Cambiar relación de aspecto"
        >
          <Text style={styles.ratioText}>{ratio}</Text>
        </Pressable>
      </View>

      {/* Zoom controls (right) */}
      <View style={styles.zoomControls}>
        <Text style={styles.zoomLabel}>×{zoomFactor.toFixed(1)}</Text>
        <Pressable
          onPress={() => setZoom((z) => Math.min(1, Math.round((z + 0.15) * 100) / 100))}
          style={styles.zoomButton}
          accessibilityRole="button"
          accessibilityLabel="Acercar"
        >
          <Text style={styles.zoomButtonText}>＋</Text>
        </Pressable>
        <Pressable
          onPress={() => setZoom((z) => Math.max(0, Math.round((z - 0.15) * 100) / 100))}
          style={styles.zoomButton}
          accessibilityRole="button"
          accessibilityLabel="Alejar"
        >
          <Text style={styles.zoomButtonText}>－</Text>
        </Pressable>
      </View>

      {/* Shutter / record button */}
      <View style={styles.shutterRow}>
        {mode === 'photo' ? (
          <Pressable
            onPress={takePhoto}
            disabled={taking}
            accessibilityRole="button"
            accessibilityLabel="Tomar foto"
            style={styles.shutterButton}
          >
            {taking ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </Pressable>
        ) : recording ? (
          <Pressable
            onPress={stopVideo}
            accessibilityRole="button"
            accessibilityLabel="Detener grabación"
            style={[styles.shutterButton, styles.recordButton]}
          >
            <View style={styles.recordStop} />
          </Pressable>
        ) : (
          <Pressable
            onPress={startVideo}
            accessibilityRole="button"
            accessibilityLabel="Empezar a grabar"
            style={styles.shutterButton}
          >
            <View style={styles.recordDot} />
          </Pressable>
        )}
      </View>

      {/* Saved toast */}
      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  permissionTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  permissionText: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  permissionActions: { alignSelf: 'stretch' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 56,
    paddingBottom: 12,
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  torchOn: { backgroundColor: 'rgba(245,158,11,0.85)' },
  flashButton: { minWidth: 62, paddingHorizontal: 8 },
  flashLabel: { fontSize: 11 },
  iconText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  topTitle: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  modeBar: {
    position: 'absolute',
    top: 104,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    padding: 3,
  },
  modeChip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 17 },
  modeChipActive: { backgroundColor: '#FFFFFF' },
  modeChipText: { color: '#E2E8F0', fontSize: 13, fontWeight: '700' },
  modeChipTextActive: { color: colors.text },
  stampOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 132,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    padding: 12,
  },
  stampTitle: { color: '#FFF', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  stampLine: { color: '#E2E8F0', fontSize: 13, marginTop: 2 },
  stampHint: { color: '#FBBF24', fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  ratioControl: {
    position: 'absolute',
    left: 14,
    top: '38%',
  },
  ratioChip: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ratioText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  zoomControls: {
    position: 'absolute',
    right: 14,
    top: '38%',
    alignItems: 'center',
    gap: 8,
  },
  zoomLabel: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  zoomButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButtonText: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  shutterRow: {
    position: 'absolute',
    bottom: 44,
    alignSelf: 'center',
    alignItems: 'center',
  },
  shutterButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFF',
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF' },
  recordButton: { borderColor: '#F87171', backgroundColor: 'rgba(220,38,38,0.4)' },
  recordDot: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#DC2626' },
  recordStop: { width: 26, height: 26, borderRadius: 4, backgroundColor: '#FFF' },
  toast: {
    position: 'absolute',
    bottom: 134,
    alignSelf: 'center',
    backgroundColor: 'rgba(22,163,74,0.92)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  toastText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
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
import { persistCapturedPhoto } from '../../lib/media';
import type { Project } from '../../lib/types';

interface GeoState {
  status: 'idle' | 'loading' | 'ready' | 'denied' | 'error';
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
}

type FlashMode = 'off' | 'auto' | 'on';

interface Shot {
  uri: string;
  capturedAt: string; // ISO UTC
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

export default function CaptureScreen() {
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { user, token } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [flash, setFlash] = useState<FlashMode>('off');
  const [zoom, setZoom] = useState(0); // 0..1 mapped to device zoom range
  const [now, setNow] = useState(new Date());
  const [geo, setGeo] = useState<GeoState>({
    status: 'idle',
    latitude: null,
    longitude: null,
    altitude: null,
  });
  const [shot, setShot] = useState<Shot | null>(null);
  const [taking, setTaking] = useState(false);
  const [saving, setSaving] = useState(false);

  // Live clock for the overlay stamp.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

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
          setProject(data);
        }
      } catch {
        // Non-fatal: capture works even if the project fetch fails.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [token, projectId]);

  // Location permission + first GPS fix.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const granted = await requestLocation();
        if (!mounted) {
          return;
        }
        if (!granted) {
          setGeo({ status: 'denied', latitude: null, longitude: null, altitude: null });
          return;
        }
        setGeo((g) => ({ ...g, status: 'loading' }));
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (mounted) {
          setGeo({
            status: 'ready',
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            altitude: position.coords.altitude,
          });
        }
      } catch {
        if (mounted) {
          setGeo({ status: 'error', latitude: null, longitude: null, altitude: null });
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshGps = async (): Promise<void> => {
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setGeo({
        status: 'ready',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitude: position.coords.altitude,
      });
    } catch {
      // Keep the previous fix.
    }
  };

  const takePhoto = async () => {
    if (!cameraRef.current || taking) {
      return;
    }
    setTaking(true);
    try {
      // Capture immediately — the GPS keeps refreshing in the background, so
      // the shutter feels instant and the freshest fix is used when saving.
      const result = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      setShot({ uri: result.uri, capturedAt: new Date().toISOString() });
      void refreshGps();
    } catch {
      Alert.alert('Error', 'No se pudo capturar la foto. Intenta de nuevo.');
    } finally {
      setTaking(false);
    }
  };

  const saveShot = async () => {
    if (!shot || !projectId || !user || saving) {
      return;
    }
    setSaving(true);
    try {
      const photoId = generateId();
      const localUri = await persistCapturedPhoto(shot.uri, photoId);
      await createLocalPhoto({
        id: photoId,
        projectId,
        userId: user.id,
        localUri,
        latitude: geo.latitude,
        longitude: geo.longitude,
        altitude: geo.altitude,
        capturedAt: shot.capturedAt,
      });
      // Queue the photo for sync (F2 adds the R2 upload step).
      await enqueueSync('photo', photoId, {
        id: photoId,
        projectId,
        capturedAt: shot.capturedAt,
        latitude: geo.latitude,
        longitude: geo.longitude,
        altitude: geo.altitude,
      });
      Alert.alert(
        'Foto guardada',
        'Se guardó en el dispositivo y quedó en cola para sincronizar.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      Alert.alert('Error al guardar', errorMessage(error));
      setSaving(false);
    }
  };

  const projectLine = project ? `${project.code} · ${project.name}` : 'Cargando proyecto…';
  const zoomFactor = 1 + zoom * 3; // approximate visual multiplier for the label
  const gpsLine =
    geo.status === 'ready' && geo.latitude != null
      ? `📍 ${geo.latitude.toFixed(6)}, ${geo.longitude?.toFixed(6) ?? '-'}` +
        (geo.altitude != null ? ` · ${Math.round(geo.altitude)} m` : '')
      : '📍 GPS no disponible';
  const stampLines = [`🏗️ ${projectLine}`, `👤 ${user?.fullName ?? ''}`, gpsLine];

  // Preview after capture.
  if (shot) {
    return (
      <View style={styles.previewContainer}>
        <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        <View style={styles.previewStamp}>
          <Text style={styles.stampTitle}>📷 Foto capturada</Text>
          <Text style={styles.stampLine}>{formatClock(new Date(shot.capturedAt))}</Text>
          {stampLines.map((line, i) => (
            <Text key={i} style={styles.stampLine}>
              {line}
            </Text>
          ))}
        </View>
        <View style={styles.previewActions}>
          <View style={styles.previewActionItem}>
            <Button
              title="Descartar"
              variant="secondary"
              onPress={() => setShot(null)}
              disabled={saving}
            />
          </View>
          <View style={styles.previewActionItem}>
            <Button
              title={saving ? 'Guardando…' : 'Guardar foto'}
              onPress={saveShot}
              loading={saving}
            />
          </View>
        </View>
      </View>
    );
  }

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
        flash={flash}
        zoom={zoom}
        onMountError={() => Alert.alert('Error', 'No se pudo iniciar la cámara.')}
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.iconButton}
          accessibilityRole="button"
        >
          <Text style={styles.iconText}>✕</Text>
        </Pressable>
        <Text style={styles.topTitle}>{project ? project.code : 'Captura'}</Text>
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

      {/* Live stamp overlay */}
      <View style={styles.stampOverlay} pointerEvents="none">
        <Text style={styles.stampTitle}>📷 {formatClock(now)}</Text>
        {stampLines.map((line, i) => (
          <Text key={i} style={styles.stampLine}>
            {line}
          </Text>
        ))}
        {geo.status === 'loading' ? <Text style={styles.stampHint}>Obteniendo GPS…</Text> : null}
        {geo.status === 'denied' ? (
          <Text style={styles.stampHint}>Sin permiso de ubicación: la foto irá sin GPS.</Text>
        ) : null}
      </View>

      {/* Zoom controls */}
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

      {/* Shutter */}
      <View style={styles.shutterRow}>
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
      </View>
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
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashButton: { minWidth: 68, paddingHorizontal: 10 },
  flashLabel: { fontSize: 12 },
  iconText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  topTitle: { color: '#FFF', fontSize: 16, fontWeight: '700' },
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
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButtonText: { color: '#FFF', fontSize: 22, fontWeight: '700' },
  stampOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 130,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    padding: 12,
  },
  stampTitle: { color: '#FFF', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  stampLine: { color: '#E2E8F0', fontSize: 13, marginTop: 2 },
  stampHint: { color: '#FBBF24', fontSize: 12, marginTop: 6, fontStyle: 'italic' },
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
  previewContainer: { flex: 1, backgroundColor: '#000' },
  previewStamp: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 130,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    padding: 12,
  },
  previewActions: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 40,
    flexDirection: 'row',
  },
  previewActionItem: { flex: 1, marginHorizontal: 6 },
});

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import React, { useEffect } from 'react';
import { AuthProvider } from '../lib/auth';
import { SyncProvider } from '../lib/sync';
import { initDatabase } from '../lib/db';
import { CenterLoader, colors } from '../components/ui';

export default function RootLayout() {
  // Brand typography: Space Grotesk (display) + Manrope (UI text).
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  // Initialize the local SQLite database (idempotent, versioned migrations).
  useEffect(() => {
    initDatabase().catch((error) => {
      console.error('Failed to initialize local database', error);
    });
  }, []);

  // Keep the splash/loader until the brand fonts are ready (a font failure
  // must not block the app — we fall back to the system font).
  if (!fontsLoaded && !fontError) {
    return <CenterLoader />;
  }

  return (
    <AuthProvider>
      <SyncProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </SyncProvider>
    </AuthProvider>
  );
}

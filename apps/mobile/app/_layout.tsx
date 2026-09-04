import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AuthProvider } from '../lib/auth';
import { initDatabase } from '../lib/db';
import { colors } from '../components/ui';

export default function RootLayout() {
  // Initialize the local SQLite database (idempotent, versioned migrations).
  useEffect(() => {
    initDatabase().catch((error) => {
      console.error('Failed to initialize local database', error);
    });
  }, []);

  return (
    <AuthProvider>
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
    </AuthProvider>
  );
}

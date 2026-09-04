import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { CenterLoader } from '../../components/ui';
import { useAuth } from '../../lib/auth';

export default function AppLayout() {
  const { status } = useAuth();
  if (status === 'loading') {
    return <CenterLoader />;
  }
  if (status !== 'signedIn') {
    return <Redirect href="/login" />;
  }
  return (
    <Stack
      screenOptions={{
        headerTintColor: '#1D4ED8',
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Proyectos' }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Proyecto' }} />
      <Stack.Screen name="new-project" options={{ title: 'Nuevo proyecto' }} />
    </Stack>
  );
}

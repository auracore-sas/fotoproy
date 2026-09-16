import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { CenterLoader, colors, fonts } from '../../components/ui';
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
        headerTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="capture" options={{ headerShown: false }} />
      <Stack.Screen name="gallery" options={{ title: 'Galería' }} />
      <Stack.Screen name="media-viewer" options={{ headerShown: false }} />
      <Stack.Screen name="project/[id]" options={{ title: 'Proyecto' }} />
      <Stack.Screen name="new-project" options={{ title: 'Nuevo proyecto' }} />
      <Stack.Screen name="profile" options={{ title: 'Perfil' }} />
      <Stack.Screen name="plans/[projectId]" options={{ title: 'Planos' }} />
      <Stack.Screen name="plan-viewer" options={{ headerShown: false }} />
      <Stack.Screen name="plan-photos" options={{ title: 'Fotos del plano' }} />
    </Stack>
  );
}

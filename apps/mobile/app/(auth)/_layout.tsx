import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { CenterLoader, colors } from '../../components/ui';
import { useAuth } from '../../lib/auth';

export default function AuthLayout() {
  const { status } = useAuth();
  if (status === 'loading') {
    return <CenterLoader />;
  }
  if (status === 'signedIn') {
    return <Redirect href="/" />;
  }
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}

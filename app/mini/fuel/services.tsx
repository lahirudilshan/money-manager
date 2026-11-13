import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

/**
 * The service log now lives in Maintenance → History, together with the
 * schedule it feeds. Kept as a route so old links and notifications still land.
 */
export default function ServicesRedirect() {
  const { vehicle } = useLocalSearchParams<{ vehicle?: string }>();
  return (
    <Redirect
      href={`/mini/fuel/maintenance?tab=history${vehicle ? `&vehicle=${vehicle}` : ''}`}
    />
  );
}

import { Tabs } from 'expo-router';
import React from 'react';
import { TabBar } from '../../src/components/TabBar';

/**
 * The tab bar floats above the content (see TabBar), so screens add their own
 * bottom padding via `TAB_BAR_CLEARANCE` rather than reserving layout space
 * here.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="list" options={{ title: 'List' }} />
      <Tabs.Screen name="loans" options={{ title: 'Loans' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      {/*
        Accounts & income are managed screens reached from the dashboard and
        settings, not primary destinations — kept as routes but pulled off the
        dock with href:null so the bar stays to four clear tabs.
      */}
      <Tabs.Screen name="cards" options={{ href: null }} />
      <Tabs.Screen name="income" options={{ href: null }} />
    </Tabs>
  );
}

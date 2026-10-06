import { useSyncExternalStore } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isUnauthenticated, subscribeAuth } from './api/client';
import { DayScreen } from './screens/DayScreen';
import { HealthSetupScreen } from './screens/HealthSetupScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { PhotosScreen } from './screens/PhotosScreen';
import { RecapScreen } from './screens/RecapScreen';
import { SetupNeeded } from './screens/SetupNeeded';
import { TrendScreen } from './screens/TrendScreen';

export default function App() {
  const signedOut = useSyncExternalStore(subscribeAuth, isUnauthenticated, isUnauthenticated);
  if (signedOut) return <SetupNeeded />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DayScreen mode="today" />} />
        <Route path="/history" element={<HistoryScreen />} />
        <Route path="/trend" element={<TrendScreen />} />
        <Route path="/recap" element={<RecapScreen />} />
        <Route path="/photos" element={<PhotosScreen />} />
        <Route path="/health-setup" element={<HealthSetupScreen />} />
        <Route path="/day/:date" element={<DayScreen mode="date" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

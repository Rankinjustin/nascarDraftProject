import { Outlet, Route, Routes } from "react-router";
import { RequireAuth } from "./auth";
import { Layout } from "./components/Layout";
import { AdminPage, MembersTab, TracksTab } from "./pages/AdminPage";
import { AdminRacePage } from "./pages/AdminRacePage";
import { AdminRacesTab } from "./pages/AdminRacesTab";
import { DraftPage } from "./pages/DraftPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { LivePage } from "./pages/LivePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFound } from "./pages/NotFound";
import { SeasonPage } from "./pages/SeasonPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="draft/:raceId?" element={<DraftPage />} />
        <Route path="live/:raceId?" element={<LivePage />} />
        <Route path="history/:seasonId?" element={<HistoryPage />} />
        <Route path="season/:seasonId?" element={<SeasonPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="admin"
          element={
            <RequireAuth commissioner>
              <Outlet />
            </RequireAuth>
          }
        >
          <Route element={<AdminPage />}>
            <Route index element={<AdminRacesTab />} />
            <Route path="members" element={<MembersTab />} />
            <Route path="tracks" element={<TracksTab />} />
          </Route>
          <Route path="races/:raceId" element={<AdminRacePage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

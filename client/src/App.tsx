import { Route, Routes } from "react-router";
import { RequireAuth } from "./auth";
import { Layout } from "./components/Layout";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { ComingSoon } from "./pages/ComingSoon";
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
        <Route path="draft/:raceId?" element={<ComingSoon title="Draft room" phase={4} />} />
        <Route path="live/:raceId?" element={<ComingSoon title="Live race" phase={5} />} />
        <Route path="history" element={<ComingSoon title="Past weeks" phase={6} />} />
        <Route path="season/:seasonId?" element={<ComingSoon title="Season stats" phase={7} />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="admin"
          element={
            <RequireAuth commissioner>
              <AdminPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<ComingSoon title="Not found" />} />
      </Route>
    </Routes>
  );
}

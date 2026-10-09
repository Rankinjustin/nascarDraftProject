/** Light / dark / follow the phone. Saved per device; index.html applies it before first paint. */
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "theme";
const prefersLight = window.matchMedia("(prefers-color-scheme: light)");

export function getThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage blocked (private mode): follow the phone.
  }
  return "system";
}

function applyTheme(choice: ThemeChoice) {
  const light = choice === "light" || (choice === "system" && prefersLight.matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  // The browser bar follows the page; the manifest's theme_color is fixed, so it stays dark.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f1f5f9" : "#0f172a");
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Still applies for this visit.
  }
  applyTheme(choice);
}

// Follow the phone switching between light and dark while the app is open.
prefersLight.addEventListener("change", () => applyTheme(getThemeChoice()));

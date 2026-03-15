"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG } from "@/shared/constants/config";

const THEME_CYCLE = ["light", "dark", "cyberpunk"];

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: THEME_CONFIG.defaultTheme,

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      toggleTheme: () => {
        const currentTheme = get().theme;
        const idx = THEME_CYCLE.indexOf(currentTheme);
        const newTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
        set({ theme: newTheme });
        applyTheme(newTheme);
      },

      initTheme: () => {
        const theme = get().theme;
        applyTheme(theme);
      },
    }),
    {
      name: THEME_CONFIG.storageKey,
    }
  )
);

// Apply theme to document
function applyTheme(theme) {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

  const effectiveTheme = theme === "system" ? systemTheme : theme;

  root.classList.remove("dark", "cyberpunk");
  if (effectiveTheme === "dark") {
    root.classList.add("dark");
  } else if (effectiveTheme === "cyberpunk") {
    root.classList.add("cyberpunk");
  }
}

export default useThemeStore;


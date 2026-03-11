"use client";

import { useTheme } from "@/shared/hooks/useTheme";
import { cn } from "@/shared/utils/cn";

const THEME_ICONS = {
  light: "dark_mode",
  dark: "electric_bolt",
  cyberpunk: "light_mode",
};

const THEME_LABELS = {
  light: "Switch to dark mode",
  dark: "Switch to cyberpunk mode",
  cyberpunk: "Switch to light mode",
};

export default function ThemeToggle({ className, variant = "default" }) {
  const { theme, toggleTheme } = useTheme();
  const isCyberpunk = theme === "cyberpunk";

  const variants = {
    default: cn(
      "flex items-center justify-center size-10 rounded-full",
      "text-text-muted",
      "hover:bg-black/5",
      "hover:text-text-main",
      "transition-colors",
      isCyberpunk && "hover:bg-[#FF2D95]/10"
    ),
    card: cn(
      "flex items-center justify-center size-11 rounded-full",
      "bg-surface/60",
      "hover:bg-surface",
      "border border-border",
      "backdrop-blur-md shadow-sm hover:shadow-md",
      "text-text-muted-light hover:text-primary",
      "hover:text-primary",
      "transition-all group",
      isCyberpunk && "hover:shadow-[0_0_12px_rgba(255,45,149,0.3)]"
    ),
  };

  const icon = THEME_ICONS[theme] || "dark_mode";
  const label = THEME_LABELS[theme] || "Toggle theme";

  return (
    <button
      onClick={toggleTheme}
      className={cn(variants[variant], className)}
      aria-label={label}
      title={label}
    >
      <span
        className={cn(
          "material-symbols-outlined text-[22px]",
          variant === "card" && "transition-transform duration-300 group-hover:rotate-12",
          isCyberpunk && "text-[#FF2D95]"
        )}
      >
        {icon}
      </span>
    </button>
  );
}


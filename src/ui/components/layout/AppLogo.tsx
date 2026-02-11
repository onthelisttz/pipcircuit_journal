"use client";

interface AppLogoProps {
  collapsed?: boolean;
  className?: string;
}

/**
 * AppLogo
 *
 * CSS-only monogram logo that works in light and dark themes.
 */
export function AppLogo({ collapsed = false, className }: AppLogoProps) {
  return (
    <div className={`flex items-center ${className ?? ""}`}>
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent font-extrabold tracking-tight text-sidebar-accent-foreground shadow-sm ${
          collapsed ? "h-9 w-9 text-xs" : "h-10 w-10 text-[13px]"
        }`}
      >
        PJ
      </span>
    </div>
  );
}

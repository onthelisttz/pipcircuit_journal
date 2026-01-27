"use client";

import { Moon, Sun, RefreshCw, ChevronDown, User } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * Header Component
 *
 * Top navigation bar with account switcher and theme toggle.
 */
export function Header() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    // Prevent hydration mismatch
    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <header className="flex items-center justify-between h-16 px-6 bg-background border-b border-border">
            {/* Left side - Page title or breadcrumb placeholder */}
            <div className="flex items-center gap-4">
                <h1 className="text-lg font-medium text-foreground">Dashboard</h1>
            </div>

            {/* Right side - Actions */}
            <div className="flex items-center gap-3">
                {/* Sync Status */}
                <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
            text-muted-foreground hover:bg-accent hover:text-accent-foreground
            transition-colors duration-150"
                    title="Sync status"
                >
                    <RefreshCw className="w-4 h-4" />
                    <span className="hidden sm:inline">Synced</span>
                </button>

                {/* Account Switcher */}
                <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
            bg-secondary text-secondary-foreground hover:bg-secondary/80
            transition-colors duration-150"
                >
                    <User className="w-4 h-4" />
                    <span className="hidden sm:inline">Demo Account</span>
                    <ChevronDown className="w-4 h-4" />
                </button>

                {/* Theme Toggle */}
                {mounted && (
                    <button
                        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                        className="p-2 rounded-lg text-muted-foreground hover:bg-accent 
              hover:text-accent-foreground transition-colors duration-150"
                        aria-label="Toggle theme"
                    >
                        {theme === "dark" ? (
                            <Sun className="w-5 h-5" />
                        ) : (
                            <Moon className="w-5 h-5" />
                        )}
                    </button>
                )}
            </div>
        </header>
    );
}

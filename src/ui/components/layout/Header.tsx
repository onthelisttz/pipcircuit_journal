"use client";

import { Moon, Sun, ChevronDown, User, LogOut, Menu, MoreVertical } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { SyncStatusBadge } from "./SyncStatusBadge";
import { useAccount, useAuth } from "@ui/hooks";

/**
 * Header Component
 *
 * Top navigation bar with account switcher and theme toggle.
 */
export function Header({ onMenuToggle }: { onMenuToggle?: () => void }) {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);
    const actionsMenuRef = useRef<HTMLDivElement | null>(null);
    const { activeAccount, accounts, setActive } = useAccount();
    const { logout } = useAuth();

    // Prevent hydration mismatch
    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
                setAccountMenuOpen(false);
            }
            if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
                setActionsMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => {
            document.removeEventListener("mousedown", handleClick);
        };
    }, []);

    return (
        <header className="flex items-center justify-between h-16 px-6 bg-background border-b border-border">
            {/* Left side - Page title or breadcrumb placeholder */}
            <div className="flex items-center gap-4">
                <button
                    onClick={onMenuToggle}
                    className="md:hidden p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    aria-label="Toggle navigation"
                >
                    <Menu className="w-4 h-4" />
                </button>
                <h1 className="text-lg font-medium text-foreground">Dashboard</h1>
            </div>

            {/* Right side - Actions */}
            <div className="flex items-center gap-3">
                {/* Sync Status */}
                <SyncStatusBadge />

                {/* Account Switcher */}
                <div className="relative" ref={accountMenuRef}>
                    <button
                        onClick={() => setAccountMenuOpen((prev) => !prev)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
            bg-secondary text-secondary-foreground hover:bg-secondary/80
            transition-colors duration-150"
                        aria-haspopup="menu"
                        aria-expanded={accountMenuOpen}
                    >
                        <User className="w-4 h-4" />
                        <span className="hidden sm:inline">
                            {activeAccount?.name ?? activeAccount?.accountNumber ?? "No Account"}
                        </span>
                        <ChevronDown className="w-4 h-4" />
                    </button>
                    {accountMenuOpen && (
                        <div
                            className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
                            role="menu"
                        >
                            {accounts.length === 0 && (
                                <div className="px-3 py-2 text-muted-foreground">
                                    No accounts linked
                                </div>
                            )}
                            {accounts.map((account) => (
                                <button
                                    key={account.id ?? account.accountNumber}
                                    onClick={() => {
                                        if (account.id) {
                                            void setActive(account.id);
                                            setAccountMenuOpen(false);
                                        }
                                    }}
                                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-accent"
                                    role="menuitem"
                                >
                                    <span>
                                        {account.name ?? account.broker ?? account.accountNumber}
                                    </span>
                                    {account.id === activeAccount?.id && (
                                        <span className="text-xs text-emerald-500">Active</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="relative" ref={actionsMenuRef}>
                    <button
                        onClick={() => setActionsMenuOpen((prev) => !prev)}
                        className="p-2 rounded-lg text-muted-foreground hover:bg-accent
            hover:text-accent-foreground transition-colors duration-150"
                        aria-label="Actions"
                        aria-haspopup="menu"
                        aria-expanded={actionsMenuOpen}
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    {actionsMenuOpen && (
                        <div
                            className="absolute right-0 mt-2 w-44 rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
                            role="menu"
                        >
                            {mounted && (
                                <button
                                    onClick={() =>
                                        setTheme(theme === "dark" ? "light" : "dark")
                                    }
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent"
                                    role="menuitem"
                                >
                                    {theme === "dark" ? (
                                        <Sun className="w-4 h-4" />
                                    ) : (
                                        <Moon className="w-4 h-4" />
                                    )}
                                    <span>Toggle theme</span>
                                </button>
                            )}
                            <button
                                onClick={() => void logout()}
                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent"
                                role="menuitem"
                            >
                                <LogOut className="w-4 h-4" />
                                <span>Log out</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

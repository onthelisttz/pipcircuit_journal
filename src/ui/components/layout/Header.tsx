"use client";

import { Moon, Sun, ChevronDown, User, LogOut, Menu, MoreVertical, Download } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { SyncStatusBadge } from "./SyncStatusBadge";
import { useAccount, useAuth } from "@ui/hooks";
import { ConfirmDialog } from "@ui/components/common";
import { useOnlineStatus } from "@ui/hooks/useOnlineStatus";

/**
 * Header Component
 *
 * Top navigation bar with account switcher and theme toggle.
 */
export function Header({ onMenuToggle }: { onMenuToggle?: () => void }) {
    const { theme, setTheme } = useTheme();
    const isOnline = useOnlineStatus();
    const [mounted, setMounted] = useState(false);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
    const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
    const [syncingTrades, setSyncingTrades] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);
    const actionsMenuRef = useRef<HTMLDivElement | null>(null);
    const { activeAccount, accounts, setActive, syncTradesForAccount } = useAccount();
    const formatAccountLabel = (account?: { name?: string | null; broker?: string | null; accountNumber: string; type?: string | null }) => {
        if (!account) return "No Account";
        const base =
            account.name ??
            account.broker ??
            account.accountNumber;
        return account.type ? `${base} (${account.type})` : base;
    };
    const { user, logout } = useAuth();

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
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/95 px-1 backdrop-blur sm:px-3 md:px-6">
            {/* Left side - Menu toggle only (page title handled by pages themselves) */}
            <div className="flex items-center gap-4">
                <button
                    onClick={onMenuToggle}
                    className="md:hidden p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    aria-label="Toggle navigation"
                >
                    <Menu className="w-4 h-4" />
                </button>
            </div>

            {/* Right side - Actions */}
            <div className="flex items-center gap-3">
                {/* Sync Status */}
                <SyncStatusBadge />

                <button
                    onClick={async () => {
                        if (!activeAccount || syncingTrades || !isOnline) return;
                        setSyncingTrades(true);
                        try {
                            await syncTradesForAccount(
                                activeAccount.accountNumber,
                                activeAccount.ctraderAccountId
                            );
                        } catch {
                            // Keep behavior silent in header action.
                        } finally {
                            setSyncingTrades(false);
                        }
                    }}
                    disabled={!activeAccount || syncingTrades || !isOnline}
                    className="p-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
                    aria-label="Download trades for active account"
                    title="Download trades"
                >
                    <Download className={`w-4 h-4 ${syncingTrades ? "animate-spin" : ""}`} />
                </button>

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
                            {formatAccountLabel(activeAccount)}
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
                                        {formatAccountLabel(account)}
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
                            className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
                            role="menu"
                        >
                            {user?.email && (
                              <div className="mb-1 border-b border-border px-3 py-2">
                                <p className="text-[11px] text-muted-foreground">Signed in as</p>
                                <p className="truncate text-xs text-foreground">{user.email}</p>
                              </div>
                            )}
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
                                onClick={() => setLogoutConfirmOpen(true)}
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

            <ConfirmDialog
              open={logoutConfirmOpen}
              onClose={() => setLogoutConfirmOpen(false)}
              onConfirm={() => {
                setLogoutConfirmOpen(false);
                void logout();
              }}
              title="Log out"
              message="Are you sure you want to log out? Any unsynced local changes will be pushed the next time you log in on this device."
              confirmLabel="Log out"
              cancelLabel="Cancel"
              variant="danger"
            />
        </header>
    );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    LineChart,
    Eye,
    Tag,
    Users,
    Settings,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import { useState } from "react";

/**
 * Navigation items for the sidebar
 */
const navItems = [
    {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
    },
 
    {
        label: "Observations",
        href: "/observations",
        icon: Eye,
    },
    {
        label: "Chart",
        href: "/chart",
        icon: LineChart,
    },
    {
        label: "Tags",
        href: "/tags",
        icon: Tag,
    },
    {
        label: "Accounts",
        href: "/accounts",
        icon: Users,
    },
    {
        label: "Settings",
        href: "/settings",
        icon: Settings,
    },
];

/**
 * Sidebar Component
 *
 * Main navigation sidebar for the application.
 * Collapsible with icon-only mode.
 */
export function Sidebar({ className }: { className?: string }) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);

    return (
        <aside
            className={`
        sticky top-0 flex flex-col h-screen bg-sidebar border-r border-sidebar-border
        shrink-0 transition-colors duration-150
        ${collapsed ? "w-16" : "w-64"}
        ${className ?? ""}
      `}
        >
            {/* Logo/Brand */}
            <div className="flex items-center h-16 px-4 border-b border-sidebar-border">
                <Link
                    href="/dashboard"
                    className="flex items-center justify-center flex-1 text-sidebar-foreground hover:text-sidebar-primary"
                    aria-label="Go to dashboard"
                >
                    {!collapsed && (
                        <span className="text-lg font-semibold">
                            pipCircuit
                        </span>
                    )}
                    {collapsed && (
                        <span className="text-lg font-bold text-sidebar-primary mx-auto">
                            PC
                        </span>
                    )}
                </Link>
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="ml-auto hidden md:inline-flex items-center justify-center rounded-lg p-2 text-sidebar-foreground hover:bg-sidebar-accent/50"
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed ? (
                        <ChevronRight className="w-4 h-4" />
                    ) : (
                        <ChevronLeft className="w-4 h-4" />
                    )}
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-4 overflow-y-auto">
                <ul className="space-y-1 px-2">
                    {navItems.map((item) => {
                        const isActive = pathname?.startsWith(item.href);
                        const Icon = item.icon;

                        return (
                            <li key={item.href}>
                                <Link
                                    href={item.href}
                                    className={`
                    flex items-center gap-3 px-3 py-2 rounded-lg
                    transition-colors duration-150
                    ${isActive
                                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                            : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                                        }
                    ${collapsed ? "justify-center" : ""}
                  `}
                                    title={collapsed ? item.label : undefined}
                                >
                                    <Icon className="w-5 h-5 shrink-0" />
                                    <span className={collapsed ? "hidden" : "inline"}>
                                        {item.label}
                                    </span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* Collapse Toggle */}
            <div className="p-2 border-t border-sidebar-border md:hidden">
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="
            w-full flex items-center justify-center p-2 rounded-lg
            text-sidebar-foreground hover:bg-sidebar-accent/50
            transition-colors duration-150
          "
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed ? (
                        <ChevronRight className="w-5 h-5" />
                    ) : (
                        <ChevronLeft className="w-5 h-5" />
                    )}
                </button>
            </div>
        </aside>
    );
}

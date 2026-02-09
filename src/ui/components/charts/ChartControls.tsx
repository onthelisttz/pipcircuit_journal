"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, Activity, TrendingDown, TrendingUp, Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";

export interface ChartControlsProps {
    onResetView: () => void;
    showProfitTimeline: boolean;
    onToggleProfitTimeline: () => void;
    showMAE: boolean;
    onToggleMAE: () => void;
    showMFE: boolean;
    onToggleMFE: () => void;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    disabled?: boolean;
}

export function ChartControls({
    onResetView,
    showProfitTimeline,
    onToggleProfitTimeline,
    showMAE,
    onToggleMAE,
    showMFE,
    onToggleMFE,
    isExpanded = false,
    onToggleExpand,
    disabled = false,
}: ChartControlsProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ left: 0, top: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const updateMenuPosition = () => {
        const btn = buttonRef.current;
        if (btn) {
            const rect = btn.getBoundingClientRect();
            setMenuPos({ left: rect.left, top: rect.bottom + 4 });
        }
    };

    const handleToggleMenu = () => {
        if (!menuOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setMenuPos({ left: rect.left, top: rect.bottom + 4 });
        }
        setMenuOpen((o) => !o);
    };

    useEffect(() => {
        if (!menuOpen) return;
        const handleScroll = () => updateMenuPosition();
        const handleResize = () => updateMenuPosition();
        window.addEventListener("scroll", handleScroll, true);
        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("scroll", handleScroll, true);
            window.removeEventListener("resize", handleResize);
        };
    }, [menuOpen]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                menuRef.current && !menuRef.current.contains(e.target as Node) &&
                buttonRef.current && !buttonRef.current.contains(e.target as Node)
            ) {
                setMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const dropdown = menuOpen && (
        <div
            ref={menuRef}
            className="fixed z-[9999] min-w-[140px] rounded-md border border-gray-700 bg-gray-900 py-1 shadow-xl"
            style={{ left: menuPos.left, top: menuPos.top }}
        >
            <button
                type="button"
                onClick={() => {
                    onToggleProfitTimeline();
                    setMenuOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-800 ${
                    showProfitTimeline ? "bg-purple-600/20 text-purple-400" : "text-gray-300"
                }`}
            >
                <Activity className="h-3.5 w-3.5 shrink-0" />
                P&L
            </button>
            <button
                type="button"
                onClick={() => {
                    onToggleMAE();
                    setMenuOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-800 ${
                    showMAE ? "bg-red-600/20 text-red-400" : "text-gray-300"
                }`}
            >
                <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                MAE
            </button>
            <button
                type="button"
                onClick={() => {
                    onToggleMFE();
                    setMenuOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-800 ${
                    showMFE ? "bg-green-600/20 text-green-400" : "text-gray-300"
                }`}
            >
                <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                MFE
            </button>
            <div className="my-1 border-t border-gray-700" />
            <button
                type="button"
                onClick={() => {
                    onResetView();
                    setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-300 transition-colors hover:bg-gray-800"
            >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                Reset
            </button>
        </div>
    );

    return (
        <div className="flex shrink-0 flex-nowrap items-center gap-1">
            {/* Chart options dropdown - P&L, MAE, MFE, Reset */}
            <button
                ref={buttonRef}
                type="button"
                onClick={handleToggleMenu}
                disabled={disabled}
                className={`flex h-6 w-6 items-center justify-center rounded transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    menuOpen || showProfitTimeline || showMAE || showMFE
                        ? "bg-gray-700 text-gray-200"
                        : "bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                }`}
                title="Chart options (P&L, MAE, MFE, Reset)"
            >
                <SlidersHorizontal className="h-3 w-3" />
            </button>

            {typeof document !== "undefined" && createPortal(dropdown, document.body)}

            {/* Expand - icon only */}
            {onToggleExpand && (
                <button
                    type="button"
                    onClick={onToggleExpand}
                    disabled={disabled}
                    className="flex h-6 w-6 items-center justify-center rounded bg-gray-800/50 text-gray-400 transition-all hover:bg-gray-700 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                    title={isExpanded ? "Collapse" : "Expand chart"}
                >
                    {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                </button>
            )}
        </div>
    );
}

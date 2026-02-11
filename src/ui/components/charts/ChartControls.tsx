"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
    RotateCcw,
    Activity,
    TrendingDown,
    TrendingUp,
    Maximize2,
    Minimize2,
    SlidersHorizontal,
    Pencil,
    Target,
    Type,
} from "lucide-react";
import type { DrawingToolType } from "./TradeCandlestickChart";

const DRAW_TOOLS: { id: DrawingToolType; label: string }[] = [
    { id: "Path", label: "Path" },
    { id: "TrendLine", label: "Trendline" },
    { id: "Rectangle", label: "Rectangle" },
    { id: "LongShortPosition", label: "Long/Short" },
];

export interface ChartControlsProps {
    onResetView: () => void;
    showProfitTimeline: boolean;
    onToggleProfitTimeline: () => void;
    showMAE: boolean;
    onToggleMAE: () => void;
    showMFE: boolean;
    onToggleMFE: () => void;
    showRiskReward?: boolean;
    onToggleRiskReward?: () => void;
    showRiskRewardLabels?: boolean;
    onToggleRiskRewardLabels?: () => void;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    disabled?: boolean;
    drawingTool?: DrawingToolType | null;
    onDrawingToolChange?: (tool: DrawingToolType | null) => void;
}

export function ChartControls({
    onResetView,
    showProfitTimeline,
    onToggleProfitTimeline,
    showMAE,
    onToggleMAE,
    showMFE,
    onToggleMFE,
    showRiskReward = true,
    onToggleRiskReward,
    showRiskRewardLabels = true,
    onToggleRiskRewardLabels,
    isExpanded = false,
    onToggleExpand,
    disabled = false,
    drawingTool = null,
    onDrawingToolChange,
}: ChartControlsProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [drawMenuOpen, setDrawMenuOpen] = useState(false);
    const [drawMenuPos, setDrawMenuPos] = useState({ left: 0, top: 0 });
    const drawButtonRef = useRef<HTMLButtonElement>(null);
    const drawMenuRef = useRef<HTMLDivElement>(null);
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
        setDrawMenuOpen(false);
    };

    const handleToggleDrawMenu = () => {
        if (!drawMenuOpen && drawButtonRef.current) {
            const rect = drawButtonRef.current.getBoundingClientRect();
            setDrawMenuPos({ left: rect.left, top: rect.bottom + 4 });
        }
        setDrawMenuOpen((o) => !o);
        setMenuOpen(false);
    };

    const handleSelectDrawTool = (tool: DrawingToolType) => {
        const next = drawingTool === tool ? null : tool;
        onDrawingToolChange?.(next);
        setDrawMenuOpen(false);
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
            const target = e.target as Node;
            if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
                setMenuOpen(false);
            }
            if (!drawMenuRef.current?.contains(target) && !drawButtonRef.current?.contains(target)) {
                setDrawMenuOpen(false);
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
            {onToggleRiskReward && (
                <button
                    type="button"
                    onClick={() => {
                        onToggleRiskReward();
                        setMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-800 ${
                        showRiskReward ? "bg-blue-600/20 text-blue-400" : "text-gray-300"
                    }`}
                >
                    <Target className="h-3.5 w-3.5 shrink-0" />
                    R:R Zones
                </button>
            )}
            {onToggleRiskRewardLabels && (
                <button
                    type="button"
                    onClick={() => {
                        onToggleRiskRewardLabels();
                        setMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-800 ${
                        showRiskRewardLabels ? "bg-teal-600/20 text-teal-400" : "text-gray-300"
                    }`}
                >
                    <Type className="h-3.5 w-3.5 shrink-0" />
                    R:R Labels
                </button>
            )}
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

    const drawDropdown = drawMenuOpen && onDrawingToolChange && (
        <div
            ref={drawMenuRef}
            className="fixed z-[9999] min-w-[140px] rounded-md border border-gray-700 bg-gray-900 py-1 shadow-xl"
            style={{ left: drawMenuPos.left, top: drawMenuPos.top }}
        >
            {DRAW_TOOLS.map(({ id, label }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectDrawTool(id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-800 ${
                        drawingTool === id ? "bg-blue-600/20 text-blue-400" : "text-gray-300"
                    }`}
                >
                    {label}
                </button>
            ))}
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
                    menuOpen || showProfitTimeline || showMAE || showMFE || showRiskReward || showRiskRewardLabels
                        ? "bg-gray-700 text-gray-200"
                        : "bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                }`}
                title="Chart options (P&L, MAE, MFE, R:R, labels, Reset)"
            >
                <SlidersHorizontal className="h-3 w-3" />
            </button>

            {typeof document !== "undefined" && createPortal(dropdown, document.body)}

            {onDrawingToolChange && (
                <>
                    <button
                        ref={drawButtonRef}
                        type="button"
                        onClick={handleToggleDrawMenu}
                        disabled={disabled}
                        className={`flex h-6 items-center gap-1 rounded px-2 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                            drawMenuOpen || drawingTool
                                ? "bg-gray-700 text-gray-200"
                                : "bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                        }`}
                        title="Drawing tools"
                    >
                        <Pencil className="h-3 w-3 shrink-0" />
                        <span className="text-[11px]">Draw</span>
                    </button>
                    {typeof document !== "undefined" && createPortal(drawDropdown, document.body)}
                </>
            )}

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

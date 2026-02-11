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
    showProfitTimeline?: boolean;
    onToggleProfitTimeline?: () => void;
    showMAE?: boolean;
    onToggleMAE?: () => void;
    showMFE?: boolean;
    onToggleMFE?: () => void;
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
    showProfitTimeline = false,
    onToggleProfitTimeline,
    showMAE = false,
    onToggleMAE,
    showMFE = false,
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

    const hasAnyActiveToggle =
        (onToggleProfitTimeline && showProfitTimeline) ||
        (onToggleMAE && showMAE) ||
        (onToggleMFE && showMFE) ||
        (onToggleRiskReward && showRiskReward) ||
        (onToggleRiskRewardLabels && showRiskRewardLabels);

    const dropdown = menuOpen && (
        <div
            ref={menuRef}
            className="fixed z-[9999] min-w-[156px] rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-xl"
            style={{ left: menuPos.left, top: menuPos.top }}
        >
            {onToggleProfitTimeline && (
                <button
                    type="button"
                    onClick={() => {
                        onToggleProfitTimeline();
                        setMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                        showProfitTimeline ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                    }`}
                >
                    <Activity className="h-3.5 w-3.5 shrink-0" />
                    P&L
                </button>
            )}
            {onToggleMAE && (
                <button
                    type="button"
                    onClick={() => {
                        onToggleMAE();
                        setMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                        showMAE ? "bg-destructive/15 text-destructive" : "text-muted-foreground"
                    }`}
                >
                    <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                    MAE
                </button>
            )}
            {onToggleMFE && (
                <button
                    type="button"
                    onClick={() => {
                        onToggleMFE();
                        setMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                        showMFE ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                    }`}
                >
                    <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                    MFE
                </button>
            )}
            {onToggleRiskReward && (
                <button
                    type="button"
                    onClick={() => {
                        onToggleRiskReward();
                        setMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                        showRiskReward ? "bg-sky-500/15 text-sky-600 dark:text-sky-400" : "text-muted-foreground"
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
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                        showRiskRewardLabels ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" : "text-muted-foreground"
                    }`}
                >
                    <Type className="h-3.5 w-3.5 shrink-0" />
                    R:R Labels
                </button>
            )}
            <div className="my-1 border-t border-border" />
            <button
                type="button"
                onClick={() => {
                    onResetView();
                    setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent"
            >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                Reset
            </button>
        </div>
    );

    const drawDropdown = drawMenuOpen && onDrawingToolChange && (
        <div
            ref={drawMenuRef}
            className="fixed z-[9999] min-w-[140px] rounded-md border border-border bg-popover py-1 shadow-xl"
            style={{ left: drawMenuPos.left, top: drawMenuPos.top }}
        >
            {DRAW_TOOLS.map(({ id, label }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectDrawTool(id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent ${
                        drawingTool === id ? "bg-accent text-accent-foreground" : "text-muted-foreground"
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
                    menuOpen || hasAnyActiveToggle
                        ? "bg-accent text-accent-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title="Chart options"
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
                                ? "bg-accent text-accent-foreground"
                                : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground"
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
                    className="flex h-6 w-6 items-center justify-center rounded bg-muted/50 text-muted-foreground transition-all hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    title={isExpanded ? "Collapse" : "Expand chart"}
                >
                    {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                </button>
            )}
        </div>
    );
}

"use client";

import { RotateCcw, Activity, TrendingDown, TrendingUp } from "lucide-react";

export interface ChartControlsProps {
    /** Callback for reset view action */
    onResetView: () => void;
    /** Whether profit timeline is visible */
    showProfitTimeline: boolean;
    /** Toggle profit timeline visibility */
    onToggleProfitTimeline: () => void;
    /** Whether MAE marker is visible */
    showMAE: boolean;
    /** Toggle MAE visibility */
    onToggleMAE: () => void;
    /** Whether MFE marker is visible */
    showMFE: boolean;
    /** Toggle MFE visibility */
    onToggleMFE: () => void;
    /** Disabled state */
    disabled?: boolean;
}

/**
 * ChartControls - Chart action buttons and toggles
 *
 * Reset view and visibility toggles for chart overlays.
 */
export function ChartControls({
    onResetView,
    showProfitTimeline,
    onToggleProfitTimeline,
    showMAE,
    onToggleMAE,
    showMFE,
    onToggleMFE,
    disabled = false,
}: ChartControlsProps) {
    return (
        <div className="flex items-center gap-2">
            {/* Reset View */}
            <button
                onClick={onResetView}
                disabled={disabled}
                className="flex items-center gap-1.5 rounded-md bg-gray-800/50 px-3 py-1.5 text-xs font-medium text-gray-400 transition-all hover:bg-gray-700 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                title="Reset View"
            >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
            </button>

            {/* Divider */}
            <div className="h-6 w-px bg-gray-700" />

            {/* Profit Timeline Toggle */}
            <button
                onClick={onToggleProfitTimeline}
                disabled={disabled}
                className={`
          flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all
          ${showProfitTimeline
                        ? "bg-purple-600/20 text-purple-400"
                        : "bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                    }
          disabled:cursor-not-allowed disabled:opacity-50
        `}
                title="Toggle Profit Timeline"
            >
                <Activity className="h-3.5 w-3.5" />
                P&L
            </button>

            {/* MAE Toggle */}
            <button
                onClick={onToggleMAE}
                disabled={disabled}
                className={`
          flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all
          ${showMAE
                        ? "bg-red-600/20 text-red-400"
                        : "bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                    }
          disabled:cursor-not-allowed disabled:opacity-50
        `}
                title="Maximum Adverse Excursion"
            >
                <TrendingDown className="h-3.5 w-3.5" />
                MAE
            </button>

            {/* MFE Toggle */}
            <button
                onClick={onToggleMFE}
                disabled={disabled}
                className={`
          flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all
          ${showMFE
                        ? "bg-green-600/20 text-green-400"
                        : "bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                    }
          disabled:cursor-not-allowed disabled:opacity-50
        `}
                title="Maximum Favorable Excursion"
            >
                <TrendingUp className="h-3.5 w-3.5" />
                MFE
            </button>
        </div>
    );
}

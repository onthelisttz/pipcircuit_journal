"use client";

import type { ChartTimeframe } from "@domain/entities";

export interface TimeframeSelectorProps {
    /** Currently selected timeframe */
    value: ChartTimeframe;
    /** Callback when timeframe changes */
    onChange: (timeframe: ChartTimeframe) => void;
    /** Disabled state */
    disabled?: boolean;
}

const TIMEFRAMES: ChartTimeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];

/**
 * TimeframeSelector - Timeframe button group
 *
 * Allows switching between different chart timeframes.
 */
export function TimeframeSelector({
    value,
    onChange,
    disabled = false,
}: TimeframeSelectorProps) {
    return (
        <div className="flex items-center gap-1 rounded-lg bg-gray-800/50 p-1">
            {TIMEFRAMES.map((tf) => (
                <button
                    key={tf}
                    onClick={() => onChange(tf)}
                    disabled={disabled}
                    className={`
            rounded-md px-3 py-1.5 text-xs font-medium transition-all
            ${value === tf
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                        }
            ${disabled ? "cursor-not-allowed opacity-50" : ""}
          `}
                >
                    {tf}
                </button>
            ))}
        </div>
    );
}

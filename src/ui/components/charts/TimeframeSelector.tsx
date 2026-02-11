"use client";

import { ChevronDown } from "lucide-react";
import type { ChartTimeframe } from "@domain/entities";

export interface TimeframeSelectorProps {
    value: ChartTimeframe;
    onChange: (timeframe: ChartTimeframe) => void;
    disabled?: boolean;
}

const TIMEFRAMES: ChartTimeframe[] = ["M1", "M5", "M15", "H1"];

export function TimeframeSelector({
    value,
    onChange,
    disabled = false,
}: TimeframeSelectorProps) {
    return (
        <div className="relative shrink-0">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value as ChartTimeframe)}
                disabled={disabled}
                className="h-7 appearance-none rounded-md border border-border bg-card pl-2 pr-6 text-[11px] font-medium text-foreground outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
                {TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>
                        {tf}
                    </option>
                ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        </div>
    );
}

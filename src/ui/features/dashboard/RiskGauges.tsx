"use client";

interface GaugeProps {
  label: string;
  value: number;
  max?: number;
  format?: (v: number) => string;
}

function getGaugeColor(value: number, label: string): string {
  if (label === "Profit Factor") {
    if (value >= 1.5) return "text-emerald-500";
    if (value >= 1) return "text-yellow-500";
    return "text-destructive";
  }
  if (label === "Z-Score") {
    if (value >= 1.96 || value <= -1.96) return "text-emerald-500";
    if (value >= 1 || value <= -1) return "text-yellow-500";
    return "text-muted-foreground";
  }
  if (label === "Sharpe" || label === "Sortino") {
    if (value >= 1) return "text-emerald-500";
    if (value >= 0.5) return "text-yellow-500";
    return value >= 0 ? "text-muted-foreground" : "text-destructive";
  }
  return "text-foreground";
}

function Gauge({ label, value, max = 3, format = (v) => v.toFixed(2) }: GaugeProps) {
  const displayValue = Number.isFinite(value) ? value : 0;
  const clamped = Math.min(Math.max(displayValue, -max), max);
  const percent = ((clamped + max) / (2 * max)) * 100;
  const colorClass = getGaugeColor(displayValue, label);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      <p className={`text-xl font-semibold ${colorClass}`}>
        {format(displayValue)}
      </p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

interface RiskGaugesProps {
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  zScore: number;
}

export function RiskGauges({
  profitFactor,
  sharpeRatio,
  sortinoRatio,
  zScore,
}: RiskGaugesProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Gauge
        label="Profit Factor"
        value={profitFactor}
        max={3}
        format={(v) => (v >= 100 ? "∞" : v.toFixed(2))}
      />
      <Gauge label="Sharpe Ratio" value={sharpeRatio} max={2} />
      <Gauge label="Sortino Ratio" value={sortinoRatio} max={2} />
      <Gauge label="Z-Score" value={zScore} max={3} />
    </div>
  );
}

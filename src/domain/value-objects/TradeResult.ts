import { ValidationError } from "../errors";

export class TradeResult {
  public readonly grossProfit: number;
  public readonly netProfit: number;
  public readonly percentGain: number;

  constructor(grossProfit: number, netProfit: number, percentGain: number) {
    if (!Number.isFinite(grossProfit)) {
      throw new ValidationError("Gross profit must be a finite number", "grossProfit");
    }
    if (!Number.isFinite(netProfit)) {
      throw new ValidationError("Net profit must be a finite number", "netProfit");
    }
    if (!Number.isFinite(percentGain)) {
      throw new ValidationError("Percent gain must be a finite number", "percentGain");
    }

    this.grossProfit = grossProfit;
    this.netProfit = netProfit;
    this.percentGain = percentGain;
  }
}

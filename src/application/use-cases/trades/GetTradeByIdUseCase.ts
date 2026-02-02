import type { ITradeRepository } from "@application/ports/repositories";
import type { Trade } from "@domain/entities";

export interface GetTradeByIdParams {
    id: number;
}

export class GetTradeByIdUseCase {
    constructor(private readonly tradeRepository: ITradeRepository) { }

    async execute(params: GetTradeByIdParams): Promise<Trade | null> {
        return this.tradeRepository.getById(params.id);
    }
}

import type {
  CTraderAccountInfo,
  ICTraderAPI,
} from "@application/ports/services";
import type { IAccountRepository } from "@application/ports/repositories";
import type { Account } from "@domain/entities";

export class LinkCTraderAccountsUseCase {
  constructor(
    private readonly api: ICTraderAPI,
    private readonly accountRepository: IAccountRepository
  ) {}

  async execute(accessToken: string): Promise<Account[]> {
    const remoteAccounts: CTraderAccountInfo[] = await this.api.getAccounts(accessToken);
    const savedAccounts: Account[] = [];

    for (const remote of remoteAccounts) {
      const existing = await this.accountRepository.getByAccountNumber(remote.accountNumber);
      const record: Account = {
        accountNumber: remote.accountNumber,
        platform: "cTrader",
        broker: remote.broker,
        name: remote.name,
        type: remote.type,
        currency: remote.currency,
        balance: remote.balance,
        equity: remote.equity,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (existing?.id) {
        const updated = await this.accountRepository.update(existing.id, {
          ...record,
          updatedAt: new Date(),
        });
        savedAccounts.push(updated);
      } else {
        const created = await this.accountRepository.create(record);
        savedAccounts.push(created);
      }
    }

    if (savedAccounts.length > 0) {
      const primary = savedAccounts[0];
      if (primary.id) {
        await this.accountRepository.setActive(primary.id);
      }
    }

    return savedAccounts;
  }
}

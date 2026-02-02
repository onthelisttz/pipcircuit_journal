import type { IAccountRepository } from "@application/ports/repositories";

export class SetActiveAccountUseCase {
  constructor(private readonly accountRepository: IAccountRepository) {}

  async execute(accountId: number): Promise<void> {
    await this.accountRepository.setActive(accountId);
  }
}

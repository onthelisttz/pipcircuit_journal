import type { IAuthService } from "@application/ports/services";

export class LogoutUseCase {
  constructor(private readonly authService: IAuthService) {}

  async execute(): Promise<void> {
    await this.authService.signOut();
  }
}

import type { IAuthService } from "@application/ports/services";

export class LoginUseCase {
  constructor(private readonly authService: IAuthService) {}

  async execute(): Promise<void> {
    await this.authService.signInWithGoogle();
  }
}

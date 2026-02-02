import type { AuthUser, IAuthService } from "@application/ports/services";

export class GetCurrentUserUseCase {
  constructor(private readonly authService: IAuthService) {}

  async execute(): Promise<AuthUser | null> {
    const session = await this.authService.getSession();
    return session?.user ?? null;
  }
}

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Código estável para o front reagir (ex.: TOTP_REQUIRED). */
    public code?: string,
  ) {
    super(message);
  }
}

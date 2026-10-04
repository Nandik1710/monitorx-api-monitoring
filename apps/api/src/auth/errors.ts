export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const denied = (): AuthError =>
  new AuthError(401, "AUTHENTICATION_FAILED", "Unable to authenticate.");
export const invalidToken = (): AuthError =>
  new AuthError(400, "INVALID_TOKEN", "This link is invalid or expired.");

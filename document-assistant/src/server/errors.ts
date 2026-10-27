/**
 * Errors carry a plain-English message that is safe to show to employees.
 * Internal details (stack traces, provider responses) are never sent to the browser.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class NotSignedInError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(401, "not_signed_in", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do that. If you think you should, contact your administrator.") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "We couldn't find that item. It may have been removed, or you may not have access to it.") {
    super(404, "not_found", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "invalid", message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, "conflict", message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests. Please wait a minute and try again.") {
    super(429, "rate_limited", message);
  }
}

export class SuspendedError extends AppError {
  constructor(message: string) {
    super(423, "suspended", message);
  }
}

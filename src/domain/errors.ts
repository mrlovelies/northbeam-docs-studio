// Typed domain errors. Route handlers map each to an HTTP status and a typed
// body ({ error: code, ...details }); the service only ever throws these.

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

// 400: missing/invalid input, including a draft write with no version token.
export class ValidationError extends DomainError {
  constructor(message = "Invalid request", details?: Record<string, unknown>) {
    super(400, "validation_error", message, details);
  }
}

// 404: resource absent, or a reader asking for anything not published (existence
// is never revealed).
export class NotFoundError extends DomainError {
  constructor(message = "Not found", details?: Record<string, unknown>) {
    super(404, "not_found", message, details);
  }
}

// 409: resource-state conflict. `code` distinguishes the cases a client cares
// about (e.g. "version_conflict" with { current }, "slug_taken",
// "live_version", "not_published").
export class ConflictError extends DomainError {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(409, code, message, details);
  }
}

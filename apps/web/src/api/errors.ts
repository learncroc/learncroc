import type { ApiError } from "@learncroc/core";

/** A non-2xx API response, carrying the typed ApiError body (code, message, AI fallback hint). */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
    this.name = "ApiClientError";
  }

  get code(): ApiError["error"] {
    return this.body.error;
  }
}

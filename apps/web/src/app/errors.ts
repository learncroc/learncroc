import { ApiClientError } from "../api/errors";

/** A short, specific description of a failed call: "404 no such pack", "Failed to fetch". */
export function errorText(err: unknown): string {
  if (err instanceof ApiClientError) {
    const msg = err.body.message;
    return msg.startsWith(String(err.status)) ? msg : `${err.status} ${msg}`;
  }
  if (err instanceof Error) return err.message;
  return "unknown error";
}

/** True when the server says the feature isn't built yet (stubs answer 501). */
export const isNotImplemented = (err: unknown): boolean => err instanceof ApiClientError && err.status === 501;

/** True when the server answered (with an error), as opposed to not answering at all. */
export const isServerError = (err: unknown): boolean => err instanceof ApiClientError;

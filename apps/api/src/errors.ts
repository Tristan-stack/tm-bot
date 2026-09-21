/**
 * Every error body of the API: a fixed word per status, never the message of an error.
 * A status that is not listed answers the word of its class.
 */
const ERROR_WORDS: Readonly<Record<number, string>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  413: "payload_too_large",
  415: "unsupported_media_type",
  429: "too_many_requests",
};

export const errorBody = (status: number): { error: string } => ({
  error: ERROR_WORDS[status] ?? (status >= 500 ? "internal_error" : "bad_request"),
});

/**
 * The status the client gets for an error. A 4xx set on purpose (by Fastify, or by a route
 * that throws an error carrying `statusCode`: 403, 404, 429 in V1-23) is the fault of the
 * request and goes through. Anything else is ours: 500, and nothing about it leaves the server.
 */
export function clientStatus(error: unknown): number {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? status : 500;
}

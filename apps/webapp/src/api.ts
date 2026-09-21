import { INIT_DATA_HEADER, joinUrl } from "@launchbot/shared";
import { API_URL } from "./config";
import { getWebApp } from "./telegram";

/**
 * `status` is the HTTP status (401, 403, 404…), `"network"` when the API could not be
 * reached, or `"invalid"` when its answer does not match the expected schema.
 */
export class ApiError extends Error {
  readonly status: number | "network" | "invalid";

  constructor(status: ApiError["status"]) {
    super(`API request failed: ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Anything with a `parse`, which is what a zod schema is: the webapp needs no zod import. */
type Schema<T> = { parse: (data: unknown) => T };

/**
 * Calls the API with the raw initData of Telegram in `X-Telegram-Init-Data`. Outside Telegram
 * there is no initData: the request would be refused, so it is not even sent.
 */
export async function apiFetch<T>(path: string, schema: Schema<T>): Promise<T> {
  const initData = getWebApp()?.initData ?? "";
  if (initData === "") throw new ApiError(401);

  const response = await fetch(joinUrl(API_URL, path), {
    headers: { [INIT_DATA_HEADER]: initData },
  }).catch(() => {
    throw new ApiError("network");
  });
  if (!response.ok) throw new ApiError(response.status);

  try {
    return schema.parse(await response.json());
  } catch {
    throw new ApiError("invalid");
  }
}

import { API_IMAGE_MAX_BYTES, TELEGRAM_FILE_TIMEOUT_MS } from "../constants.js";

export type TelegramImageType = "image/jpeg" | "image/png" | "image/webp";

/** Why a file could not be served: the status the API answers is the route's business. */
export type TelegramFileFailure = "unsupported_type" | "too_large" | "unavailable";

export class TelegramFileError extends Error {
  readonly reason: TelegramFileFailure;

  constructor(reason: TelegramFileFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TelegramFileError";
    this.reason = reason;
  }
}

export type TelegramFile = { bytes: Uint8Array; contentType: TelegramImageType };

export type TelegramFileClient = {
  /** The bytes of an image the user sent to the bot, by its `file_id`; throws a TelegramFileError. */
  downloadTelegramFile: (fileId: string) => Promise<TelegramFile>;
};

export type TelegramFileClientDeps = {
  botToken: string;
  /** Test seam. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
};

const TELEGRAM_API = "https://api.telegram.org";

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0): boolean =>
  prefix.every((byte, index) => bytes[offset + index] === byte);

/**
 * The type of an image from its first bytes, never from what Telegram says: JPEG, PNG and
 * WEBP only, so that no SVG (a script carrier) ever reaches the Mini App as an image.
 */
export function detectImageType(bytes: Uint8Array): TelegramImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

const tooLarge = (bytes: number, max: number) =>
  new TelegramFileError("too_large", `The file has ${bytes} bytes, ${max} allowed`);

/**
 * Bot API `getFile` then the download of the file (V1-23, V2-02). The URL of the file holds
 * BOT_TOKEN: it is built here and never leaves this module. Every message of an error is
 * fixed, without the URL, the token or the `file_path`; the cause is attached for a debugger
 * and never serialized by the logger.
 */
export function createTelegramFileClient(deps: TelegramFileClientDeps): TelegramFileClient {
  const {
    botToken,
    fetch: fetchImpl = fetch,
    timeoutMs = TELEGRAM_FILE_TIMEOUT_MS,
    maxBytes = API_IMAGE_MAX_BYTES,
  } = deps;

  const unavailable = (message: string, cause?: unknown) =>
    new TelegramFileError("unavailable", message, cause === undefined ? undefined : { cause });

  async function getFilePath(fileId: string): Promise<{ path: string; size: number | null }> {
    let response: Response;
    try {
      response = await fetchImpl(`${TELEGRAM_API}/bot${botToken}/getFile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw unavailable("Telegram getFile did not answer", error);
    }
    if (!response.ok) throw unavailable(`Telegram getFile answered ${response.status}`);
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      result?: { file_path?: unknown; file_size?: unknown };
    } | null;
    const path = body?.result?.file_path;
    if (body?.ok !== true || typeof path !== "string" || path === "") {
      throw unavailable("Telegram getFile gave no file path");
    }
    const size = body.result?.file_size;
    return { path, size: typeof size === "number" ? size : null };
  }

  return {
    async downloadTelegramFile(fileId) {
      const { path, size } = await getFilePath(fileId);
      if (size !== null && size > maxBytes) throw tooLarge(size, maxBytes);

      let response: Response;
      try {
        response = await fetchImpl(`${TELEGRAM_API}/file/bot${botToken}/${path}`, {
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw unavailable("Telegram file download did not answer", error);
      }
      if (!response.ok) throw unavailable(`Telegram file download answered ${response.status}`);
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > maxBytes) throw tooLarge(length, maxBytes);

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        throw unavailable("Telegram file download was cut", error);
      }
      if (bytes.byteLength > maxBytes) throw tooLarge(bytes.byteLength, maxBytes);
      const contentType = detectImageType(bytes);
      if (contentType === null) {
        throw new TelegramFileError("unsupported_type", "The file is not a JPEG, PNG or WEBP");
      }
      return { bytes, contentType };
    },
  };
}

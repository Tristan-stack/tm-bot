import { describe, expect, it, vi } from "vitest";
import { createTelegramFileClient, detectImageType, TelegramFileError } from "./telegram-file.js";

const TOKEN = `123456789:${"AbC-dEf_9".repeat(4)}`;
const FILE_ID = "AgACAgIAAxkBAAIB-file";
const FILE_PATH = "photos/file_1.jpg";
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

type FakeFetch = {
  getFile?: () => Response;
  file?: () => Response;
};

/** A fetch that answers getFile then the download, and records the URLs it was given. */
function fakeFetch(options: FakeFetch = {}) {
  const urls: string[] = [];
  const getFile =
    options.getFile ??
    (() => Response.json({ ok: true, result: { file_path: FILE_PATH, file_size: JPEG.length } }));
  const file = options.file ?? (() => new Response(JPEG));
  const impl = vi.fn((input: string | URL) => {
    const url = input.toString();
    urls.push(url);
    return Promise.resolve(url.endsWith("/getFile") ? getFile() : file());
  });
  return { fetch: impl as unknown as typeof fetch, urls };
}

const client = (fetchImpl: typeof fetch, options: { maxBytes?: number } = {}) =>
  createTelegramFileClient({ botToken: TOKEN, fetch: fetchImpl, ...options });

describe("detectImageType", () => {
  it("reads JPEG, PNG and WEBP from their first bytes, nothing else", () => {
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(WEBP)).toBe("image/webp");
    expect(detectImageType(SVG)).toBeNull();
    expect(detectImageType(new Uint8Array(0))).toBeNull();
    expect(detectImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41]))).toBeNull();
  });
});

describe("createTelegramFileClient", () => {
  it("asks getFile with the token, downloads the path, and types the bytes", async () => {
    const { fetch, urls } = fakeFetch();

    const file = await client(fetch).downloadTelegramFile(FILE_ID);

    expect(file).toEqual({ bytes: JPEG, contentType: "image/jpeg" });
    expect(urls).toEqual([
      `https://api.telegram.org/bot${TOKEN}/getFile`,
      `https://api.telegram.org/file/bot${TOKEN}/${FILE_PATH}`,
    ]);
    expect(fetch).toHaveBeenCalledWith(
      urls[0],
      expect.objectContaining({ method: "POST", body: JSON.stringify({ file_id: FILE_ID }) }),
    );
  });

  it("refuses what is not an image", async () => {
    const { fetch } = fakeFetch({ file: () => new Response(SVG) });

    await expect(client(fetch).downloadTelegramFile(FILE_ID)).rejects.toMatchObject({
      reason: "unsupported_type",
    });
  });

  it("refuses a file over the limit before, during and after the download", async () => {
    const big = new Uint8Array(101);
    big.set(JPEG);
    const announced = fakeFetch({
      getFile: () => Response.json({ ok: true, result: { file_path: FILE_PATH, file_size: 101 } }),
    });
    const tooLarge = { reason: "too_large" };
    await expect(
      client(announced.fetch, { maxBytes: 100 }).downloadTelegramFile(FILE_ID),
    ).rejects.toMatchObject(tooLarge);
    expect(announced.urls).toHaveLength(1);

    const headed = fakeFetch({
      file: () => new Response(big, { headers: { "content-length": "101" } }),
    });
    await expect(
      client(headed.fetch, { maxBytes: 100 }).downloadTelegramFile(FILE_ID),
    ).rejects.toMatchObject(tooLarge);

    const silent = fakeFetch({ file: () => new Response(big) });
    await expect(
      client(silent.fetch, { maxBytes: 100 }).downloadTelegramFile(FILE_ID),
    ).rejects.toMatchObject(tooLarge);
  });

  it.each<[string, FakeFetch]>([
    ["getFile answers 400", { getFile: () => new Response("{}", { status: 400 }) }],
    ["getFile gives no path", { getFile: () => Response.json({ ok: false }) }],
    ["getFile is not JSON", { getFile: () => new Response("<html>") }],
    ["the download answers 404", { file: () => new Response("", { status: 404 }) }],
  ])(
    "reports %s as unavailable, without the token, the path or the file_id",
    async (_label, options) => {
      const { fetch } = fakeFetch(options);

      const error = await client(fetch)
        .downloadTelegramFile(FILE_ID)
        .then(() => {
          throw new Error("Expected a rejection");
        })
        .catch((thrown: unknown) => thrown as TelegramFileError);

      expect(error.reason).toBe("unavailable");
      expect(error.message).not.toContain(TOKEN);
      expect(error.message).not.toContain(FILE_PATH);
      expect(error.message).not.toContain(FILE_ID);
    },
  );

  it("reports a network failure as unavailable, keeping its cause off the message", async () => {
    const refusing = vi.fn(() =>
      Promise.reject(
        new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/getFile`),
      ),
    ) as unknown as typeof fetch;

    const error = await client(refusing)
      .downloadTelegramFile(FILE_ID)
      .then(() => {
        throw new Error("Expected a rejection");
      })
      .catch((thrown: unknown) => thrown as TelegramFileError);

    expect(error).toBeInstanceOf(TelegramFileError);
    expect(error.reason).toBe("unavailable");
    expect(error.message).toBe("Telegram getFile did not answer");
    expect((error.cause as Error).message).toContain("ECONNREFUSED");
  });
});

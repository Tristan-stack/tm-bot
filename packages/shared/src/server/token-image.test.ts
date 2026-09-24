import { describe, expect, it, vi } from "vitest";
import type { TelegramFile, TelegramFileClient } from "./telegram-file.js";
import { createTokenImageService } from "./token-image.js";

const file = (tag: string): TelegramFile => ({
  bytes: new TextEncoder().encode(tag),
  contentType: "image/png",
});

describe("createTokenImageService", () => {
  it("downloads a file_id once, then serves it from memory", async () => {
    const client: TelegramFileClient = {
      downloadTelegramFile: vi.fn((fileId: string) => Promise.resolve(file(fileId))),
    };
    const images = createTokenImageService(client);

    const [a, b] = await Promise.all([images.get("f1"), images.get("f1")]);
    const c = await images.get("f1");
    await images.get("f2");

    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(client.downloadTelegramFile).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed download", async () => {
    const download = vi
      .fn<TelegramFileClient["downloadTelegramFile"]>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(file("f1"));
    const images = createTokenImageService({ downloadTelegramFile: download });

    await expect(images.get("f1")).rejects.toThrow("timeout");

    expect((await images.get("f1")).contentType).toBe("image/png");
    expect(download).toHaveBeenCalledTimes(2);
  });
});

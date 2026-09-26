import { formatSuccessPost } from "@launchbot/shared";
import type { SuccessPostInput } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { GrammyError, InputFile } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuccessPostError, publishToSuccessChannel } from "./success-channel.js";
import type { SuccessChannelApi, SuccessChannelDeps } from "./success-channel.js";

afterEach(() => {
  setLogDestination(undefined);
});

const CHANNEL = "-1001000000002";
const MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const FILE_ID = "AgACAgQAAxk-file";
const DEFAULT_URL = "https://example.com/default-token.png";
const FILE_URL =
  "https://api.telegram.org/file/bot123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/photos/x.jpg";

const launch = {
  launchStatus: "CONFIRMED" as const,
  txSignature: "sig",
  mint: MINT,
  name: "Moon Otter",
  symbol: "OTTR",
  description: "100x guaranteed, secret caption",
  devBuyLamports: 3_000_000_000n,
  soldLamports: 5_670_000_000n,
  devTokens: 96_657_870_000_000n,
};

/** A refusal of the Bot API, built the way grammY builds it. */
const refusal = (code: number, description: string, retryAfter?: number): GrammyError =>
  new GrammyError(
    "Call to 'sendPhoto' failed!",
    {
      ok: false,
      error_code: code,
      description,
      ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }),
    },
    "sendPhoto",
    {},
  );

function fakeApi(photo: (number | Error)[], message: (number | Error)[] = []) {
  const take = (outcomes: (number | Error)[]) => {
    const next = outcomes.shift() ?? 1;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve({ message_id: next });
  };
  const api = {
    sendPhoto: vi.fn(() => take(photo)),
    sendMessage: vi.fn(() => take(message)),
    getFile: vi.fn(() =>
      Promise.resolve({
        file_id: FILE_ID,
        file_unique_id: "uniq",
        file_path: "photos/file.jpg",
        file_size: 4,
      }),
    ),
  };
  return api as typeof api & SuccessChannelApi;
}

function deps(overrides: Partial<SuccessChannelDeps> = {}): SuccessChannelDeps {
  return {
    channelId: CHANNEL,
    cluster: "devnet",
    defaultImageUrl: DEFAULT_URL,
    downloadFile: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3, 4]))),
    sleep: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe("publishToSuccessChannel (V1-39)", () => {
  it("posts the file id in CHANNEL_SUCCESS_ID and returns the message id", async () => {
    const logs = captureLogs();
    const api = fakeApi([42]);
    const used = deps();

    expect(await publishToSuccessChannel(api, { ...launch, imageFileId: FILE_ID }, used)).toEqual({
      messageId: 42,
    });
    expect(api.sendPhoto).toHaveBeenCalledExactlyOnceWith(CHANNEL, FILE_ID, {
      caption: formatSuccessPost({ ...launch, imageFileId: FILE_ID }, "devnet").caption,
      parse_mode: "HTML",
    });
    expect(api.getFile).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("success_post.published");
    expect(logs.join("\n")).toContain(MINT);
    expect(logs.join("\n")).not.toContain("100x guaranteed");
    expect(logs.join("\n")).not.toContain(FILE_URL);
  });

  it("downloads the file and sends it again when Telegram refuses the file id", async () => {
    const api = fakeApi([refusal(400, "Bad Request: wrong file identifier specified"), 43]);
    const used = deps();

    expect(await publishToSuccessChannel(api, { ...launch, imageFileId: FILE_ID }, used)).toEqual({
      messageId: 43,
    });
    expect(api.getFile).toHaveBeenCalledExactlyOnceWith(FILE_ID);
    expect(used.downloadFile).toHaveBeenCalledExactlyOnceWith(FILE_ID);
    expect(api.sendPhoto).toHaveBeenCalledTimes(2);
    const calls = api.sendPhoto.mock.calls as unknown[][];
    expect(calls[1]?.[1]).toBeInstanceOf(InputFile);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("uses the default image when the draft has none", async () => {
    const api = fakeApi([44]);

    expect(await publishToSuccessChannel(api, launch, deps())).toEqual({ messageId: 44 });
    expect(api.sendPhoto).toHaveBeenCalledExactlyOnceWith(CHANNEL, DEFAULT_URL, {
      caption: formatSuccessPost(launch, "devnet").caption,
      parse_mode: "HTML",
    });
    expect(api.getFile).not.toHaveBeenCalled();
  });

  it("sends the caption as text when every image fails, and logs no file URL", async () => {
    const logs = captureLogs();
    const api = fakeApi(
      [
        refusal(400, "Bad Request: wrong file identifier specified"),
        refusal(400, "Bad Request: failed to get HTTP URL content"),
      ],
      [45],
    );
    const used = deps({
      downloadFile: vi.fn(() => Promise.reject(new Error(FILE_URL))),
    });

    expect(await publishToSuccessChannel(api, { ...launch, imageFileId: FILE_ID }, used)).toEqual({
      messageId: 45,
    });
    expect(api.sendMessage).toHaveBeenCalledExactlyOnceWith(
      CHANNEL,
      formatSuccessPost({ ...launch, imageFileId: FILE_ID }, "devnet").caption,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
    const written = logs.join("\n");
    expect(written).toContain("success_post.image_failed");
    expect(written).not.toContain(FILE_URL);
    expect(written).not.toContain("100x guaranteed");
    expect(written).not.toContain("123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("waits the retry_after of a 429, then posts", async () => {
    const api = fakeApi([refusal(429, "Too Many Requests: retry after 3", 3), 46]);
    const sleep = vi.fn(() => Promise.resolve());

    expect(await publishToSuccessChannel(api, launch, deps({ sleep }))).toEqual({
      messageId: 46,
    });
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3_000);
    expect(api.sendPhoto).toHaveBeenCalledTimes(2);
  });

  it("turns a 403 into SuccessPostError and posts nothing else", async () => {
    const api = fakeApi([refusal(403, "Forbidden: bot was kicked from the channel chat")]);

    await expect(publishToSuccessChannel(api, launch, deps())).rejects.toEqual(
      expect.objectContaining({
        name: "SuccessPostError",
        reason: "The bot cannot post in the Success channel",
      }),
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.getFile).not.toHaveBeenCalled();
  });

  it("refuses a launch that is not confirmed, and publishes nothing", async () => {
    const api = fakeApi([1]);

    await expect(
      publishToSuccessChannel(
        api,
        { ...launch, launchStatus: "SIMULATED" } as unknown as SuccessPostInput,
        deps(),
      ),
    ).rejects.toEqual(expect.objectContaining({ reason: "Only a confirmed launch can be posted" }));
    const { devTokens: _devTokens, ...withoutTokens } = launch;
    void _devTokens;
    await expect(
      publishToSuccessChannel(api, withoutTokens as SuccessPostInput, deps()),
    ).rejects.toEqual(expect.objectContaining({ reason: "The dev token amount is required" }));
    expect(api.sendPhoto).not.toHaveBeenCalled();
  });

  it("says so when the default image is required and missing", async () => {
    const api = fakeApi([1]);

    await expect(
      publishToSuccessChannel(api, launch, deps({ defaultImageUrl: undefined })),
    ).rejects.toBeInstanceOf(SuccessPostError);
    expect(api.sendPhoto).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});

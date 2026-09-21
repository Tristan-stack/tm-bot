import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTelegramWebApp } from "./telegram";
import { insideTelegram } from "./test-helpers/telegram";

// React only flushes `act` in an environment that declares it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const { colorScheme, initData, close } = useTelegramWebApp();
  return (
    <button onClick={close}>
      {colorScheme}|{initData}
    </button>
  );
}

function mount() {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  delete window.Telegram;
});

describe("useTelegramWebApp", () => {
  it("falls back to a light theme and an empty initData outside Telegram", () => {
    const { container, unmount } = mount();

    expect(container.textContent).toBe("light|");
    container.querySelector("button")?.click();
    unmount();
  });

  it("re-renders when the user changes theme, and stops listening once unmounted", () => {
    const telegram = insideTelegram({ initData: "signed-by-telegram" });
    const { container, unmount } = mount();
    expect(container.textContent).toBe("light|signed-by-telegram");

    act(() => telegram.changeTheme("dark"));
    expect(container.textContent).toBe("dark|signed-by-telegram");

    unmount();
    expect(telegram.listeners.size).toBe(0);
  });

  it("closes the Mini App", () => {
    const close = vi.fn();
    insideTelegram({ close });
    const { container, unmount } = mount();

    act(() => container.querySelector("button")?.click());

    expect(close).toHaveBeenCalledOnce();
    unmount();
  });
});

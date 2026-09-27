import { describe, expect, it } from "vitest";
import { tileShortcutHint } from "./shortcuts";

describe("tileShortcutHint", () => {
  it.each([
    { platform: "MacIntel", tile: 1, expected: { label: "⌥⌘1", aria: "Alt+Meta+1" } },
    { platform: "iPad", tile: 9, expected: { label: "⌥⌘9", aria: "Alt+Meta+9" } },
    { platform: "Win32", tile: 2, expected: { label: "Ctrl+Alt+2", aria: "Control+Alt+2" } },
    { platform: "Linux x86_64", tile: 3, expected: { label: "Ctrl+Alt+3", aria: "Control+Alt+3" } },
    { platform: "MacIntel", tile: 10, expected: null },
    { platform: "MacIntel", tile: 0, expected: null },
  ])("tile $tile on $platform", ({ platform, tile, expected }) => {
    expect(tileShortcutHint(tile, platform)).toEqual(expected);
  });
});

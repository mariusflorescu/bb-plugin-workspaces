import type { PluginCommandShortcut } from "@get-bb/plugin-sdk/app";
import { NUMBERED_TILES, type NumberedTile } from "./domain";

export const tileShortcut = (tile: NumberedTile): PluginCommandShortcut => ({ key: String(tile), mod: true, alt: true });

export interface ShortcutHint {
  readonly label: string;
  readonly aria: string;
}

const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;

const MODIFIERS = [
  { held: (s: PluginCommandShortcut, apple: boolean) => s.control === true || (s.mod === true && !apple), glyph: "⌃", word: "Ctrl", aria: "Control" },
  { held: (s: PluginCommandShortcut) => s.alt === true, glyph: "⌥", word: "Alt", aria: "Alt" },
  { held: (s: PluginCommandShortcut) => s.shift === true, glyph: "⇧", word: "Shift", aria: "Shift" },
  { held: (s: PluginCommandShortcut, apple: boolean) => s.meta === true || (s.mod === true && apple), glyph: "⌘", word: "Meta", aria: "Meta" },
] as const;

function shortcutHint(shortcut: PluginCommandShortcut, platform: string): ShortcutHint {
  const apple = APPLE_PLATFORM.test(platform);
  const held = MODIFIERS.filter((modifier) => modifier.held(shortcut, apple));
  const key = shortcut.key.toUpperCase();
  return {
    label: apple ? [...held.map((modifier) => modifier.glyph), key].join("") : [...held.map((modifier) => modifier.word), key].join("+"),
    aria: [...held.map((modifier) => modifier.aria), key].join("+"),
  };
}

export function tileShortcutHint(tile: number, platform: string): ShortcutHint | null {
  const numbered = NUMBERED_TILES.find((candidate) => candidate === tile);
  return numbered === undefined ? null : shortcutHint(tileShortcut(numbered), platform);
}

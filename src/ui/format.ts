import type { readableInk } from "../domain";

export const projectCount = (count: number): string => (count === 1 ? "1 project" : `${count} projects`);

export const INK_CLASS = {
  light: "text-white",
  dark: "text-black/80",
} as const satisfies Record<ReturnType<typeof readableInk>, string>;

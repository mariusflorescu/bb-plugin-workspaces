// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { HexColorSchema } from "../domain";
import { ColorField } from "./ColorField";

function ColorHarness() {
  const [color, setColor] = useState(HexColorSchema.parse("#7c3aed"));
  return (
    <>
      <ColorField value={color} onChange={setColor} />
      <output aria-label="Chosen color">{color}</output>
    </>
  );
}

function openPicker() {
  const user = userEvent.setup();
  const slot = renderSlot({ component: ColorHarness }, {});
  const chosen = () => slot.getByRole("status", { name: "Chosen color" }).textContent;
  return { user, slot, chosen };
}

afterEach(cleanup);

describe("the color popover", () => {
  it("picks a preset and closes", async () => {
    const { user, slot, chosen } = openPicker();
    await user.click(slot.getByRole("button", { name: "Color #7c3aed" }));
    const presets = within(await slot.findByRole("radiogroup", { name: "Preset colors" }));
    expect(presets.getByRole("radio", { name: "#7c3aed" }).getAttribute("aria-checked")).toBe("true");
    await user.click(presets.getByRole("radio", { name: "#0d9488" }));
    expect(chosen()).toBe("#0d9488");
    expect(slot.queryByRole("radiogroup")).toBeNull();
  });

  it("moves between presets with the arrow keys", async () => {
    const { user, slot } = openPicker();
    await user.click(slot.getByRole("button", { name: "Color #7c3aed" }));
    const presets = within(await slot.findByRole("radiogroup", { name: "Preset colors" }));
    presets.getByRole("radio", { name: "#7c3aed" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("#4f46e5");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("#ca8a04");
  });

  it("takes a custom hex color and stays open while you adjust it", async () => {
    const { user, slot, chosen } = openPicker();
    await user.click(slot.getByRole("button", { name: "Color #7c3aed" }));
    const hex = await slot.findByRole("textbox", { name: "Hex color" });
    await user.clear(hex);
    await user.type(hex, "123abc");
    expect(chosen()).toBe("#123abc");
    expect(slot.getByRole("radiogroup", { name: "Preset colors" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Color #123abc" })).toBeTruthy();
  });
});

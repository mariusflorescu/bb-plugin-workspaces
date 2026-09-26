import { useRef, useState, type KeyboardEvent } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { buttonVariants } from "@/components/ui/button";
import { COARSE_POINTER_INPUT_HEIGHT_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { HexColorSchema, PRESET_COLORS, readableInk, type HexColor } from "../domain";
import { INK_CLASS } from "./format";

const COLUMNS = 6;
const STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS };

/**
 * The picker is react-colorful rather than <input type="color">: the native
 * macOS panel takes focus outside the page, and the popover closes mid-pick.
 */
export function ColorField({
  id,
  value,
  invalid,
  onChange,
}: {
  readonly id?: string;
  readonly value: HexColor;
  readonly invalid?: boolean;
  readonly onChange: (color: HexColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const swatches = useRef<(HTMLButtonElement | null)[]>([]);
  const emit = (next: string) => {
    const hex = HexColorSchema.safeParse(next);
    if (hex.success) onChange(hex.data);
  };
  const moveFocus = (event: KeyboardEvent, index: number) => {
    const step = STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    swatches.current[(index + step + PRESET_COLORS.length) % PRESET_COLORS.length]?.focus();
  };
  const focusIndex = Math.max(0, PRESET_COLORS.findIndex((preset) => preset === value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-invalid={invalid}
          aria-label={`Color ${value}`}
          className={cn(
            buttonVariants({ variant: "outline" }),
            COARSE_POINTER_INPUT_HEIGHT_CLASS,
            "w-full justify-start px-2 font-normal aria-[invalid=true]:border-destructive",
          )}
        >
          <span className="size-5 shrink-0 rounded border border-border" style={{ backgroundColor: value }} />
          <span className="font-mono text-xs">{value}</span>
          <Icon name="ChevronDown" className="ml-auto size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3" mobileTitle="Workspace color">
        <div role="radiogroup" aria-label="Preset colors" className="grid grid-cols-6 gap-2">
          {PRESET_COLORS.map((preset, index) => (
            <button
              key={preset}
              ref={(element) => {
                swatches.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={preset === value}
              aria-label={preset}
              tabIndex={index === focusIndex ? 0 : -1}
              className="flex size-8 items-center justify-center rounded-md outline-none ring-offset-2 ring-offset-popover focus-visible:ring-2 focus-visible:ring-ring"
              style={{ backgroundColor: preset }}
              onKeyDown={(event) => moveFocus(event, index)}
              onClick={() => {
                onChange(preset);
                setOpen(false);
              }}
            >
              {preset === value ? <Icon name="Check" className={cn("size-4", INK_CLASS[readableInk(preset)])} /> : null}
            </button>
          ))}
        </div>
        <div className="my-3 h-px bg-border" />
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon name="Palette" className="size-3.5" />
          Custom color
        </p>
        <HexColorPicker color={value} onChange={emit} style={{ width: "100%", height: 150 }} />
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          Hex
          <HexColorInput
            prefixed
            color={value}
            onChange={emit}
            aria-label="Hex color"
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}

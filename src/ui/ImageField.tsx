import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { ImageDataUrl } from "../domain";
import { downscaleToAvatar } from "./downscale-image";

export function ImageField({
  id,
  value,
  onChange,
  onError,
}: {
  readonly id?: string;
  readonly value: string | null;
  readonly onChange: (image: ImageDataUrl | null) => void;
  readonly onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [resizing, setResizing] = useState(false);
  const pick = async (file: File) => {
    setResizing(true);
    try {
      onChange(await downscaleToAvatar(file));
    } catch (error) {
      onError(error instanceof Error ? error.message : "That image couldn't be used.");
    } finally {
      setResizing(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file !== undefined) void pick(file);
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={resizing} onClick={() => input.current?.click()}>
        {resizing ? <Icon name="Loading" className="animate-spin" /> : null}
        {resizing ? "Resizing…" : value === null ? "Choose image…" : "Replace image…"}
      </Button>
      {value === null ? null : (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          <Icon name="X" />
          Remove
        </Button>
      )}
    </div>
  );
}

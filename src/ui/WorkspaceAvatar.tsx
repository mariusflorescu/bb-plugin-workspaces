import { useState } from "react";
import { cn } from "@/lib/utils";
import { displayInitials, readableInk, type HexColor, type ImageDataUrl } from "../domain";
import { INK_CLASS } from "./format";

const SIZES = {
  rail: "size-9 rounded-lg text-sm",
  row: "size-5 rounded-[5px] text-[9px]",
  preview: "size-14 rounded-xl text-lg",
} as const;

export function WorkspaceAvatar({
  workspace,
  size,
  className,
}: {
  readonly workspace: {
    readonly name: string;
    readonly initials: string | null;
    readonly color: HexColor;
    readonly image: ImageDataUrl | null;
  };
  readonly size: keyof typeof SIZES;
  readonly className?: string;
}) {
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  const image = workspace.image !== null && workspace.image !== brokenImage ? workspace.image : null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 select-none items-center justify-center overflow-hidden font-semibold leading-none",
        INK_CLASS[readableInk(workspace.color)],
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: workspace.color }}
    >
      {image === null ? (
        displayInitials(workspace)
      ) : (
        <img
          src={image}
          alt=""
          draggable={false}
          className="size-full object-cover"
          onError={() => setBrokenImage(image)}
        />
      )}
    </span>
  );
}

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  readonly label: string;
  readonly tooltip: ReactNode;
  readonly active?: boolean;
  readonly children: ReactNode;
};

/** A 36px rail button (44px to a finger) with the active pill at the rail's edge. Touch gets no tooltip. */
export const RailTileButton = forwardRef<HTMLButtonElement, Props>(function RailTileButton(
  { label, tooltip, active = false, className, children, ...props },
  ref,
) {
  const coarse = usePointerCoarse();
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative flex size-9 cursor-pointer touch-manipulation items-center justify-center rounded-lg outline-none transition-[border-radius,opacity] duration-150 [-webkit-app-region:no-drag] after:absolute after:-inset-1 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring",
        active ? "rounded-xl" : "opacity-85 hover:opacity-100",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
  return (
    <div className="group/tile relative flex w-full justify-center">
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-[height] duration-150",
          active ? "h-6" : "h-0 group-hover/tile:h-3",
        )}
      />
      {coarse ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">{tooltip}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
});

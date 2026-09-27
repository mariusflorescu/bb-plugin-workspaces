import { Icon } from "@/components/ui/icon";
import type { ShortcutHint } from "../shortcuts";
import { RailTileButton } from "./RailTileButton";

export function AllTile({
  active,
  unfiledCount,
  shortcut,
  onSelect,
}: {
  readonly active: boolean;
  readonly unfiledCount: number;
  readonly shortcut: ShortcutHint | null;
  readonly onSelect: () => void;
}) {
  return (
    <RailTileButton
      label="All workspaces"
      tooltip={unfiledCount === 0 ? "All workspaces" : `All workspaces · ${unfiledCount} not in a workspace`}
      shortcut={shortcut}
      active={active}
      className="bg-surface-selected text-foreground"
      onClick={onSelect}
    >
      <Icon name="GridView" className="size-4" />
    </RailTileButton>
  );
}

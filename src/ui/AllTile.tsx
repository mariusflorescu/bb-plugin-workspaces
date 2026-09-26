import { Icon } from "@/components/ui/icon";
import { RailTileButton } from "./RailTileButton";

export function AllTile({
  active,
  unfiledCount,
  onSelect,
}: {
  readonly active: boolean;
  readonly unfiledCount: number;
  readonly onSelect: () => void;
}) {
  return (
    <RailTileButton
      label="All workspaces"
      tooltip={unfiledCount === 0 ? "All workspaces" : `All workspaces · ${unfiledCount} not in a workspace`}
      active={active}
      className="bg-surface-selected text-foreground"
      onClick={onSelect}
    >
      <Icon name="GridView" className="size-4" />
    </RailTileButton>
  );
}

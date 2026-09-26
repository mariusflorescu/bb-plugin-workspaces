import { Icon } from "@/components/ui/icon";
import { RailTileButton } from "./RailTileButton";

export function AddTile({ firstWorkspace, onAdd }: { readonly firstWorkspace: boolean; readonly onAdd: () => void }) {
  return (
    <RailTileButton
      label="New workspace"
      tooltip={firstWorkspace ? "Group your projects by client: create a workspace" : "New workspace"}
      className="border border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      onClick={onAdd}
    >
      <Icon name="Plus" className="size-4" />
    </RailTileButton>
  );
}

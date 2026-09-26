import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { describeError, useDeleteWorkspace } from "../client";
import type { WorkspaceEntry } from "../domain";

export function DeleteWorkspaceDialog({
  entry,
  onClose,
}: {
  readonly entry: WorkspaceEntry;
  readonly onClose: () => void;
}) {
  const remove = useDeleteWorkspace();
  const { workspace, projects } = entry;
  const consequence =
    projects.length === 0
      ? "It has no projects."
      : projects.length === 1
        ? "Its project stays in BB, unfiled, and shows under All workspaces."
        : `Its ${projects.length} projects stay in BB, unfiled, and show under All workspaces.`;
  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {describeError(remove.error, "delete the workspace")}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(entry, {
                onSuccess: () => {
                  toast.success(`Deleted ${workspace.name}. ${consequence}`);
                  onClose();
                },
              })
            }
          >
            {remove.isPending ? <Icon name="Loading" className="animate-spin" /> : null}
            {remove.isPending ? "Deleting…" : "Delete workspace"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

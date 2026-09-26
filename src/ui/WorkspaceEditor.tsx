import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { describeError, openEditor, useSaveWorkspace, type BoardState } from "../client";
import { deriveInitials, type Workspace } from "../domain";
import { ColorField } from "./ColorField";
import { FieldError } from "./FieldError";
import { defaultEditorValues, editorSchema, type EditorMode } from "./editor-form";
import { ImageField } from "./ImageField";
import { ProjectChecklist } from "./ProjectChecklist";
import { WorkspaceAvatar } from "./WorkspaceAvatar";

export function WorkspaceEditor({
  mode,
  state,
  onClose,
}: {
  readonly mode: EditorMode;
  readonly state: BoardState;
  readonly onClose: () => void;
}) {
  const id = mode.kind === "create" ? mode.id : mode.entry.workspace.id;
  const existing: readonly Workspace[] =
    state.status === "ready" ? state.board.entries.map((candidate) => candidate.workspace) : [];
  const save = useSaveWorkspace();
  const coarse = usePointerCoarse();
  const form = useForm({
    resolver: zodResolver(editorSchema),
    defaultValues: defaultEditorValues(mode, existing),
    mode: "onTouched",
  });
  const { errors } = form.formState;
  const [name, initials, color, image] = useWatch({
    control: form.control,
    name: ["name", "initials", "color", "image"],
  });
  const derived = deriveInitials(name);

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { id, ...values, select: mode.kind === "create" },
      {
        onSuccess: () => {
          toast.success(`Saved ${values.name}`);
          onClose();
        },
      },
    ),
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode.kind === "create" ? "New workspace" : `Edit ${mode.entry.workspace.name}`}</DialogTitle>
          <DialogDescription>Group the projects you do for one client. Picking it shows only those projects.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="space-y-5">
          <div className="flex items-start gap-4">
            <WorkspaceAvatar size="preview" workspace={{ name, initials: initials.trim() || null, color, image }} />
            <div className="grid flex-1 grid-cols-[1fr_5.5rem] gap-3">
              <div className="space-y-1.5">
                <label htmlFor="workspace-name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="workspace-name"
                  autoFocus={!coarse}
                  placeholder="Client name"
                  aria-invalid={errors.name !== undefined}
                  aria-describedby={errors.name === undefined ? undefined : "workspace-name-error"}
                  {...form.register("name")}
                />
                <FieldError id="workspace-name-error" message={errors.name?.message} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="workspace-initials" className="text-sm font-medium">
                  Initials
                </label>
                <Input
                  id="workspace-initials"
                  placeholder={derived || "CN"}
                  aria-invalid={errors.initials !== undefined}
                  aria-describedby={errors.initials === undefined ? undefined : "workspace-initials-error"}
                  {...form.register("initials")}
                />
                <FieldError id="workspace-initials-error" message={errors.initials?.message} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="workspace-color" className="text-sm font-medium">
                Color
              </label>
              <Controller
                control={form.control}
                name="color"
                render={({ field, fieldState }) => (
                  <ColorField id="workspace-color" value={field.value} invalid={fieldState.invalid} onChange={field.onChange} />
                )}
              />
              <FieldError id="workspace-color-error" message={errors.color?.message} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="workspace-image" className="text-sm font-medium">
                Image <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Controller
                control={form.control}
                name="image"
                render={({ field }) => (
                  <ImageField
                    id="workspace-image"
                    value={field.value}
                    onChange={(next) => {
                      form.clearErrors("image");
                      field.onChange(next);
                    }}
                    onError={(message) => form.setError("image", { message })}
                  />
                )}
              />
              <FieldError id="workspace-image-error" message={errors.image?.message} />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Projects</p>
            <Controller
              control={form.control}
              name="projectIds"
              render={({ field }) => (
                <ProjectChecklist state={state} self={id} value={field.value} onChange={field.onChange} />
              )}
            />
          </div>

          {save.isError ? (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              <Icon name="AlertCircle" className="mt-0.5 size-4 shrink-0" />
              {describeError(save.error, "save the workspace")}
            </p>
          ) : null}

          <DialogFooter className="sticky bottom-0 z-10 -mx-4 flex-row justify-end gap-2 border-t border-border bg-background px-4 py-3 sm:space-x-0 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
            {mode.kind === "edit" ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive sm:mr-auto"
                onClick={() => openEditor({ kind: "delete", id })}
              >
                <Icon name="Trash2" />
                Delete…
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Icon name="Loading" className="animate-spin" /> : null}
              {save.isPending ? "Saving…" : mode.kind === "create" ? "Create workspace" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

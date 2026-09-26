import { z } from "zod";
import {
  HexColorSchema,
  ImageDataUrlSchema,
  InitialsSchema,
  PRESET_COLORS,
  ProjectIdSchema,
  WorkspaceNameSchema,
  type Workspace,
  type WorkspaceEntry,
  type WorkspaceId,
} from "../domain";

export type EditorMode =
  | { readonly kind: "create"; readonly id: WorkspaceId }
  | { readonly kind: "edit"; readonly entry: WorkspaceEntry };

/** A form field whose widget only ever emits values this schema already parsed, so the form holds the branded type. */
const alreadyParsed = <Schema extends z.ZodType>(schema: Schema, message: string) =>
  z.custom<z.output<Schema>>((value) => schema.safeParse(value).success, message);

export const editorSchema = z.object({
  name: WorkspaceNameSchema,
  initials: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(InitialsSchema.nullable()),
  color: alreadyParsed(HexColorSchema, "Pick a color"),
  image: alreadyParsed(ImageDataUrlSchema, "Pick another image").nullable(),
  projectIds: z.array(ProjectIdSchema),
});

export function defaultEditorValues(mode: EditorMode, existing: readonly Workspace[]): z.input<typeof editorSchema> {
  if (mode.kind === "edit") {
    const { workspace, projects } = mode.entry;
    return {
      name: workspace.name,
      initials: workspace.initials ?? "",
      color: workspace.color,
      image: workspace.image,
      projectIds: projects.map((project) => project.id),
    };
  }
  const used = new Set(existing.map((workspace) => workspace.color));
  return {
    name: "",
    initials: "",
    color: PRESET_COLORS.find((color) => !used.has(color)) ?? HexColorSchema.parse("#7c3aed"),
    image: null,
    projectIds: [],
  };
}

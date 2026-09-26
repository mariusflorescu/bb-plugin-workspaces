import { ImageDataUrlSchema, type ImageDataUrl } from "../domain";

const AVATAR_PX = 128;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// A browser that can't encode WebP returns PNG from toDataURL, which the schema also accepts.
const ENCODINGS: readonly (readonly [string, number])[] = [
  ["image/webp", 0.9],
  ["image/webp", 0.6],
  ["image/jpeg", 0.8],
];

export async function downscaleToAvatar(file: File): Promise<ImageDataUrl> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose an image under 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error("That image couldn't be read. Try a PNG, JPEG or WebP file.");
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (side === 0) throw new Error("That image couldn't be read. Try a PNG, JPEG or WebP file.");
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_PX;
    canvas.height = AVATAR_PX;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("This browser can't resize images.");
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_PX,
      AVATAR_PX,
    );
    for (const [type, quality] of ENCODINGS) {
      const encoded = ImageDataUrlSchema.safeParse(canvas.toDataURL(type, quality));
      if (encoded.success) return encoded.data;
    }
    throw new Error("That image is too large, even after resizing. Try a simpler image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

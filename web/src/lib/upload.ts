import { ApiError } from "./api";

const MAX_SIDE = 1600; // phone photos are 4000+ px; nobody needs that on a description page
const KEEP_AS_IS = 1.5 * 1024 * 1024;

/** Shrinks big photos in the browser so uploads are quick on school wifi and the database stays small. */
async function prepare(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new ApiError(422, "invalid", `“${file.name}” is not a picture.`);
  if (file.type === "image/gif") return file; // a canvas would flatten the animation
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ApiError(422, "invalid", `Could not read “${file.name}”. Use a PNG, JPEG, GIF or WebP picture.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= KEEP_AS_IS) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
  return blob ?? file;
}

/** Uploads one picture and returns the address to use in a description. */
export async function uploadImage(file: File): Promise<string> {
  const body = await prepare(file);
  const res = await fetch("/api/admin/images", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? "error", data.error ?? "Could not upload the picture. Please try again.");
  return data.url as string;
}

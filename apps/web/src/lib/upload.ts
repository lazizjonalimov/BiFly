import { api, unwrap } from "@/lib/api/client";
import { toApiError } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";

export type DocumentType = Schema<"UploadIntentIn">["type"];
export type EntityType = Schema<"UploadIntentIn">["entity_type"];

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

const BY_EXTENSION: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** The file's type as the browser reports it, or worked out from its name when the browser doesn't say. */
export function contentTypeOf(file: File): string | null {
  if (file.type && Object.values(BY_EXTENSION).includes(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? null;
}

/** Why a file can't be uploaded, before anything is sent. The API checks the same things, and the contents. */
export function checkFile(file: File): string | null {
  if (!contentTypeOf(file)) return "Upload a PDF, JPEG, PNG or WebP file";
  if (file.size === 0) return "That file is empty";
  if (file.size > MAX_UPLOAD_BYTES) return "Files can be up to 15 MB";
  return null;
}

/**
 * Upload in the three steps the API asks for: say what is coming, send the file where it says, confirm.
 * The same steps work unchanged when files go straight to cloud storage.
 */
export async function uploadDocument({ file, type, entityType, entityId, expiresOn }: { file: File; type: DocumentType; entityType: EntityType; entityId: string; expiresOn?: string | null }): Promise<Schema<"DocumentOut">> {
  const contentType = contentTypeOf(file);
  if (!contentType) throw new Error("Upload a PDF, JPEG, PNG or WebP file");
  const intent = await unwrap(
    api.POST("/api/v1/documents/upload-intents", {
      body: { filename: file.name, content_type: contentType, size_bytes: file.size, type, entity_type: entityType, entity_id: entityId, expires_on: expiresOn || null },
    }),
  );
  const target = intent.upload.url.startsWith("/") ? `/api/v1${intent.upload.url}` : intent.upload.url;
  const sent = await fetch(target, { method: intent.upload.method, headers: intent.upload.headers, body: file, credentials: "same-origin" });
  if (!sent.ok) throw toApiError(sent.status, await sent.json().catch(() => null));
  return unwrap(api.POST("/api/v1/documents/{document_id}/complete", { params: { path: { document_id: intent.document.id } } }));
}

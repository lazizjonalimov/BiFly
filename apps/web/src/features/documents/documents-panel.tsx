"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, FileTextIcon, ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatBytes } from "@/lib/format/text";
import { ACCEPT, checkFile, uploadDocument, type DocumentType, type EntityType } from "@/lib/upload";

type Document = Schema<"DocumentOut">;

export const DOCUMENT_TYPES: Record<string, string> = {
  bol: "Bill of lading",
  pod: "Proof of delivery",
  rate_confirmation: "Rate confirmation",
  receipt: "Receipt",
  license: "Licence",
  medical: "Medical card",
  insurance: "Insurance",
  registration: "Registration",
  inspection: "Inspection",
  maintenance: "Maintenance record",
  invoice: "Invoice",
  other: "Other",
};

/** Documents that matter for the record's paperwork carry an expiry date the safety screens watch. */
const DATED: DocumentType[] = ["license", "medical", "insurance", "registration", "inspection"];

function UploadDialog({ open, onOpenChange, types, entityType, entityId, onUploaded }: { open: boolean; onOpenChange: (open: boolean) => void; types: DocumentType[]; entityType: EntityType; entityId: string; onUploaded: (doc: Document) => void }) {
  const [type, setType] = useState<DocumentType>(types[0] ?? "other");
  const [file, setFile] = useState<File | null>(null);
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setFile(null);
      setExpires("");
      setError(null);
      setType(types[0] ?? "other");
    }
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return setError("Choose a file");
    const problem = checkFile(file);
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    try {
      const doc = await uploadDocument({ file, type, entityType, entityId, expiresOn: DATED.includes(type) ? expires : null });
      onUploaded(doc);
      setPending(false);
      close(false);
    } catch (e) {
      setPending(false);
      // Problems found before sending (wrong type, too big) are plain errors with a readable message.
      setError(e instanceof ApiError || e instanceof TypeError || !(e instanceof Error) ? errorMessage(e) : e.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Upload a document</DialogTitle>
            <DialogDescription>PDF or a photo (JPEG, PNG, WebP), up to 15 MB.</DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <div className="grid gap-1.5">
            <Label htmlFor="upload-type">What it is</Label>
            <NativeSelect id="upload-type" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPES[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="upload-file">File</Label>
            <Input id="upload-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-1.5" />
            {file ? <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p> : null}
          </div>
          {DATED.includes(type) ? (
            <div className="grid gap-1.5">
              <Label htmlFor="upload-expires">Expires</Label>
              <Input id="upload-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)} disabled={pending}>
              Cancel
            </Button>
            <SubmitButton pending={pending}>
              <UploadIcon /> Upload
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The documents attached to one record, with upload and download. Every download is checked and logged by
 * the API; there are no shareable links.
 */
export function DocumentsPanel({ entityType, entityId, types, emptyHint, onUploaded }: { entityType: EntityType; entityId: string; types: DocumentType[]; emptyHint?: string; onUploaded?: (doc: Document) => void }) {
  const org = useOrg();
  const can = useCan();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<Document | null>(null);
  const queryKey = [org.id, "documents", entityType, entityId];

  const query = useQuery({
    queryKey,
    queryFn: () => unwrap(api.GET("/api/v1/documents", { params: { query: { entity_type: entityType, entity_id: entityId, limit: 100 } } })),
  });
  const remove = useMutation({
    mutationFn: (doc: Document) => unwrap(api.DELETE("/api/v1/documents/{document_id}", { params: { path: { document_id: doc.id } } })),
    onSuccess: () => {
      toast.success("Document removed");
      void queryClient.invalidateQueries({ queryKey: [org.id, "documents"] });
    },
  });

  const canUpload = can("documents.upload");
  const docs = query.data?.items ?? [];
  const uploadButton = canUpload ? (
    <Button variant="outline" size="sm" onClick={() => setUploading(true)}>
      <UploadIcon /> Upload
    </Button>
  ) : null;

  return (
    <div>
      {query.isPending ? (
        <div className="grid gap-2 p-5">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : docs.length === 0 ? (
        <EmptyState icon={FileTextIcon} title="No documents yet" description={emptyHint} action={uploadButton ?? undefined} />
      ) : (
        <>
          <ul className="divide-y">
            {docs.map((doc) => {
              const Icon = doc.content_type.startsWith("image/") ? ImageIcon : FileTextIcon;
              const href = `/api/v1/documents/${doc.id}/download`;
              return (
                <li key={doc.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <a href={`${href}?disposition=inline`} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">
                        {doc.filename}
                      </a>
                      <span className="text-muted-foreground">{DOCUMENT_TYPES[doc.type] ?? doc.type}</span>
                      {doc.review_status !== "not_required" ? <StatusBadge status={doc.review_status} label={doc.review_status === "pending" ? "Waiting for review" : undefined} /> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[formatBytes(doc.size_bytes), doc.uploaded_by_name ? `added by ${doc.uploaded_by_name}` : null, formatDateTime(doc.created_at, org.timezone), doc.expires_on ? `expires ${formatDate(doc.expires_on)}` : null].filter(Boolean).join(" · ")}
                    </p>
                    {doc.review_status === "rejected" && doc.review_note ? <p className="mt-1 text-xs text-destructive">Sent back: {doc.review_note}</p> : null}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a href={href} aria-label={`Download ${doc.filename}`}>
                        <DownloadIcon />
                      </a>
                    </Button>
                    {can("documents.delete") ? (
                      <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(doc)} aria-label={`Remove ${doc.filename}`}>
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {uploadButton ? <div className="border-t p-3">{uploadButton}</div> : null}
        </>
      )}
      <UploadDialog
        open={uploading}
        onOpenChange={setUploading}
        types={types}
        entityType={entityType}
        entityId={entityId}
        onUploaded={(doc) => {
          toast.success(`${doc.filename} uploaded`);
          void queryClient.invalidateQueries({ queryKey: [org.id, "documents"] });
          onUploaded?.(doc);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove ${deleting?.filename}?`}
        description="The file is deleted for good. Everyone who could see it loses access."
        confirmLabel="Remove document"
        destructive
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : Promise.resolve())}
      />
    </div>
  );
}

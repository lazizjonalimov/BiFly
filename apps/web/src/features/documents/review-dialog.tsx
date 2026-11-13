"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DOCUMENT_TYPES } from "@/features/documents/documents-panel";
import { api, unwrap } from "@/lib/api/client";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";

type Document = Schema<"DocumentOut">;

/**
 * Approve a compliance document, or send it back saying what is wrong. Proofs of delivery are reviewed on
 * their load instead, because that decision also moves the load on.
 */
export function ReviewDialog({ document, onOpenChange }: { document: Document; onOpenChange: (open: boolean) => void }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: (decision: "approved" | "rejected") => unwrap(api.POST("/api/v1/documents/{document_id}/review", { params: { path: { document_id: document.id } }, body: { decision, note: note.trim() || null } })),
    onSuccess: (doc) => {
      toast.success(doc.review_status === "approved" ? `${doc.filename} approved` : `${doc.filename} sent back`);
      void queryClient.invalidateQueries({ queryKey: [org.id, "documents"] });
      void queryClient.invalidateQueries({ queryKey: [org.id, "safety"] });
      void queryClient.invalidateQueries({ queryKey: [org.id, "dashboard"] });
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof ApiError ? (e.fieldErrors.note ?? e.message) : errorMessage(e)),
  });
  const owner = document.links.map((l) => l.label).filter(Boolean).join(", ");
  return (
    <Dialog open onOpenChange={(open) => !review.isPending && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review {DOCUMENT_TYPES[document.type]?.toLowerCase() ?? "document"}</DialogTitle>
          <DialogDescription>
            {document.filename}
            {owner ? ` for ${owner}` : ""}.{" "}
            <a href={`/api/v1/documents/${document.id}/download?disposition=inline`} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
              Open it
            </a>{" "}
            before deciding.
          </DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <div className="grid gap-1.5">
          <Label htmlFor="review-note">Note (needed to send it back)</Label>
          <Textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What is wrong, so it can be fixed" rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={review.isPending}>
            Cancel
          </Button>
          <SubmitButton type="button" variant="destructive" pending={review.isPending && review.variables === "rejected"} disabled={review.isPending} onClick={() => (note.trim() ? (setError(null), review.mutate("rejected")) : setError("Say what is wrong so it can be fixed"))}>
            Send back
          </SubmitButton>
          <SubmitButton type="button" pending={review.isPending && review.variables === "approved"} disabled={review.isPending} onClick={() => (setError(null), review.mutate("approved"))}>
            Approve
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

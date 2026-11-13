"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, SelectField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LINE_KINDS, invalidateMaintenance, lineKindLabel, workOrderKey, type CostLine, type WorkOrder } from "@/features/maintenance/lib";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useOrg } from "@/lib/auth/session";
import { formatMoney, multiplyMoney } from "@/lib/format/money";
import { requiredMoney, requiredText } from "@/lib/validation";

const schema = z.object({
  kind: z.enum(["part", "labor", "other"]),
  description: requiredText("what it is", 200),
  quantity: z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter a quantity like 1 or 2.5").refine((v) => Number(v) > 0, "Enter a quantity above zero"),
  unit_cost: requiredMoney,
});
type Values = z.infer<typeof schema>;

function useRefresh(workOrderId: string) {
  const org = useOrg();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: workOrderKey(org.id, workOrderId) });
    invalidateMaintenance(queryClient, org.id);
  };
}

function LineSheet({ workOrder, line, onOpenChange }: { workOrder: WorkOrder; line?: CostLine; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh(workOrder.id);
  const initial: Values = { kind: (line?.kind as Values["kind"]) ?? "part", description: line?.description ?? "", quantity: line ? String(Number(line.quantity)) : "1", unit_cost: line ? String(line.unit_cost) : "" };
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const [formError, setFormError] = useState<string | null>(null);
  const [quantity, unitCost] = useWatch({ control: form.control, name: ["quantity", "unit_cost"] });
  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = { kind: v.kind, description: v.description.trim(), quantity: v.quantity, unit_cost: v.unit_cost };
      return line
        ? unwrap(api.PATCH("/api/v1/maintenance/work-orders/{parent_id}/lines/{item_id}", { params: { path: { parent_id: workOrder.id, item_id: line.id } }, body }))
        : unwrap(api.POST("/api/v1/maintenance/work-orders/{parent_id}/lines", { params: { path: { parent_id: workOrder.id } }, body }));
    },
    onSuccess: () => {
      toast.success(line ? "Cost saved" : "Cost added");
      refresh();
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });
  return (
    <EntitySheet
      open
      onOpenChange={onOpenChange}
      title={line ? `Edit ${line.description}` : "Add a cost"}
      description="Parts, labour and anything else this work cost."
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={line ? "Save changes" : "Add cost"}
    >
      <FieldGrid>
        <SelectField control={form.control} name="kind" label="Kind" options={[...LINE_KINDS]} />
        <TextField control={form.control} name="description" label="Description" required placeholder="Brake pads" />
        <TextField control={form.control} name="quantity" label="Quantity" inputMode="decimal" hint="Hours, for labour" />
        <TextField control={form.control} name="unit_cost" label={`Unit cost (${workOrder.currency})`} inputMode="decimal" required />
        <p className="text-sm sm:col-span-2">
          Amount: <strong className="tabular">{formatMoney(multiplyMoney(quantity ?? "", unitCost ?? ""), workOrder.currency)}</strong>
        </p>
      </FieldGrid>
    </EntitySheet>
  );
}

/** What the work cost, line by line. Costs can change while the work order is open; after that they are a record. */
export function CostLines({ workOrder }: { workOrder: WorkOrder }) {
  const refresh = useRefresh(workOrder.id);
  const [sheet, setSheet] = useState<{ line?: CostLine } | null>(null);
  const [removing, setRemoving] = useState<CostLine | null>(null);
  const remove = useMutation({
    mutationFn: (line: CostLine) => unwrap(api.DELETE("/api/v1/maintenance/work-orders/{parent_id}/lines/{item_id}", { params: { path: { parent_id: workOrder.id, item_id: line.id } } })),
    onSuccess: () => {
      toast.success("Cost removed");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const editable = workOrder.editable;

  return (
    <div className="grid gap-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Costs</h3>
        {editable ? (
          <Button variant="outline" size="sm" onClick={() => setSheet({})}>
            <PlusIcon /> Add cost
          </Button>
        ) : null}
      </div>
      {workOrder.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{editable ? "No costs yet. Add parts and labour as the work is done." : "No costs were recorded."}</p>
      ) : (
        <Table aria-label="Costs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Description</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {editable ? <TableHead className="w-20" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {workOrder.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{line.description}</TableCell>
                <TableCell>{lineKindLabel(line.kind)}</TableCell>
                <TableCell className="tabular text-right">{Number(line.quantity)}</TableCell>
                <TableCell className="tabular text-right">{formatMoney(line.unit_cost, workOrder.currency)}</TableCell>
                <TableCell className="tabular text-right">{formatMoney(line.amount, workOrder.currency)}</TableCell>
                {editable ? (
                  <TableCell className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="icon-sm" onClick={() => setSheet({ line })} aria-label={`Edit ${line.description}`}>
                      <PencilIcon />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setRemoving(line)} aria-label={`Remove ${line.description}`}>
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            <TableRow className="font-semibold hover:bg-transparent">
              <TableCell colSpan={4}>Total</TableCell>
              <TableCell className="tabular text-right">{formatMoney(workOrder.total_cost, workOrder.currency)}</TableCell>
              {editable ? <TableCell /> : null}
            </TableRow>
          </TableBody>
        </Table>
      )}
      {sheet ? <LineSheet workOrder={workOrder} line={sheet.line} onOpenChange={(open) => !open && setSheet(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.description ?? "this cost"}?`}
        description="The work order's total goes down by its amount."
        confirmLabel="Remove"
        destructive
        onConfirm={() => (removing ? remove.mutateAsync(removing) : Promise.resolve())}
      />
    </div>
  );
}

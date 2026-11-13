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
import { CheckboxField, FieldGrid, SelectField, TextField } from "@/components/forms/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHARGE_TYPES, chargeLabel, type LoadDetail } from "@/features/loads/lib";
import { loadKey } from "@/features/loads/use-load";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg } from "@/lib/auth/session";
import { formatMoney, multiplyMoney } from "@/lib/format/money";
import { formatNumber } from "@/lib/format/text";
import { optionalText, signedMoney, wholeNumber } from "@/lib/validation";

type Charge = Schema<"ChargeOut">;
type Item = Schema<"ItemOut">;

const chargeSchema = z.object({
  type: z.enum(CHARGE_TYPES.map((c) => c.value) as [string, ...string[]]),
  description: optionalText(200),
  quantity: z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter a quantity like 1 or 2.5").refine((v) => Number(v) > 0, "Enter a quantity above zero"),
  rate: signedMoney,
  billable: z.boolean(),
  driver_payable: z.boolean(),
});
type ChargeValues = z.infer<typeof chargeSchema>;

function useRefresh(loadId: string) {
  const org = useOrg();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: loadKey(org.id, loadId) });
    void queryClient.invalidateQueries({ queryKey: [org.id, "loads", "list"] });
  };
}

function ChargeSheet({ load, charge, onOpenChange }: { load: LoadDetail; charge?: Charge; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh(load.id);
  const initial: ChargeValues = { type: charge?.type ?? "detention", description: charge?.description ?? "", quantity: charge ? String(Number(charge.quantity)) : "1", rate: charge ? String(charge.rate) : "", billable: charge?.billable ?? true, driver_payable: charge?.driver_payable ?? false };
  const form = useForm<ChargeValues>({ resolver: zodResolver(chargeSchema), defaultValues: initial });
  const [formError, setFormError] = useState<string | null>(null);
  const [quantity, rate] = useWatch({ control: form.control, name: ["quantity", "rate"] });
  const save = useMutation({
    mutationFn: (v: ChargeValues) => {
      const body = { type: v.type as Charge["type"], description: v.description.trim() || null, quantity: v.quantity, rate: v.rate, billable: v.billable, driver_payable: v.driver_payable };
      return charge
        ? unwrap(api.PATCH("/api/v1/loads/{parent_id}/charges/{item_id}", { params: { path: { parent_id: load.id, item_id: charge.id } }, body }))
        : unwrap(api.POST("/api/v1/loads/{parent_id}/charges", { params: { path: { parent_id: load.id } }, body }));
    },
    onSuccess: () => {
      toast.success(charge ? "Charge saved" : "Charge added");
      refresh();
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });
  return (
    <EntitySheet
      open
      onOpenChange={onOpenChange}
      title={charge ? `Edit ${chargeLabel(charge.type)}` : "Add a charge"}
      description="Use a negative rate for a deduction."
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={charge ? "Save changes" : "Add charge"}
    >
      <FieldGrid>
        <SelectField control={form.control} name="type" label="Charge" options={CHARGE_TYPES} />
        <TextField control={form.control} name="description" label="Note" placeholder="2.5 h at the receiver" />
        <TextField control={form.control} name="quantity" label="Quantity" inputMode="decimal" />
        <TextField control={form.control} name="rate" label={`Rate (${load.currency})`} inputMode="decimal" />
        <p className="text-sm sm:col-span-2">
          Amount: <strong className="tabular">{formatMoney(multiplyMoney(quantity ?? "", rate ?? ""), load.currency)}</strong>
        </p>
        <CheckboxField control={form.control} name="billable" label="Bill the customer" hint="Billable charges are added to the invoice" />
        <CheckboxField control={form.control} name="driver_payable" label="Pay the driver" hint="Counted in the driver's settlement" />
      </FieldGrid>
    </EntitySheet>
  );
}

const itemSchema = z.object({
  description: z.string().trim().min(1, "Describe the freight").max(200),
  quantity: wholeNumber({ max: 1_000_000, label: "a quantity" }),
  unit: optionalText(30),
  weight_lbs: wholeNumber({ max: 1_000_000, label: "a weight" }),
});
type ItemValues = z.infer<typeof itemSchema>;

function ItemSheet({ load, item, onOpenChange }: { load: LoadDetail; item?: Item; onOpenChange: (open: boolean) => void }) {
  const refresh = useRefresh(load.id);
  const initial: ItemValues = { description: item?.description ?? "", quantity: item?.quantity?.toString() ?? "", unit: item?.unit ?? "", weight_lbs: item?.weight_lbs?.toString() ?? "" };
  const form = useForm<ItemValues>({ resolver: zodResolver(itemSchema), defaultValues: initial });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: ItemValues) => {
      const body = { description: v.description.trim(), quantity: v.quantity ? Number(v.quantity) : null, unit: v.unit.trim() || null, weight_lbs: v.weight_lbs ? Number(v.weight_lbs) : null };
      return item
        ? unwrap(api.PATCH("/api/v1/loads/{parent_id}/items/{item_id}", { params: { path: { parent_id: load.id, item_id: item.id } }, body }))
        : unwrap(api.POST("/api/v1/loads/{parent_id}/items", { params: { path: { parent_id: load.id } }, body }));
    },
    onSuccess: () => {
      toast.success(item ? "Freight line saved" : "Freight line added");
      refresh();
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });
  return (
    <EntitySheet open onOpenChange={onOpenChange} title={item ? "Edit freight line" : "Add a line of freight"} form={form} onSubmit={(v) => { setFormError(null); save.mutate(v); }} pending={save.isPending} formError={formError} submitLabel={item ? "Save changes" : "Add"}>
      <FieldGrid>
        <TextField control={form.control} name="description" label="Description" required className="sm:col-span-2" />
        <TextField control={form.control} name="quantity" label="Quantity" inputMode="numeric" />
        <TextField control={form.control} name="unit" label="Unit" placeholder="pallets" />
        <TextField control={form.control} name="weight_lbs" label="Weight (lb)" inputMode="numeric" />
      </FieldGrid>
    </EntitySheet>
  );
}

/** What is on the truck, and the charges on top of the rate. */
export function FreightPanel({ load, showRates }: { load: LoadDetail; showRates: boolean }) {
  const refresh = useRefresh(load.id);
  const [chargeSheet, setChargeSheet] = useState<{ charge?: Charge } | null>(null);
  const [itemSheet, setItemSheet] = useState<{ item?: Item } | null>(null);
  const [removing, setRemoving] = useState<{ kind: "charge"; charge: Charge } | { kind: "item"; item: Item } | null>(null);
  const remove = useMutation({
    mutationFn: (target: NonNullable<typeof removing>) =>
      unwrap(
        target.kind === "charge"
          ? api.DELETE("/api/v1/loads/{parent_id}/charges/{item_id}", { params: { path: { parent_id: load.id, item_id: target.charge.id } } })
          : api.DELETE("/api/v1/loads/{parent_id}/items/{item_id}", { params: { path: { parent_id: load.id, item_id: target.item.id } } }),
      ),
    onSuccess: () => {
      toast.success("Removed");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const canItems = load.editable.details;
  const canCharges = load.editable.rates;

  return (
    <div className="grid gap-6 p-5">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Freight</h3>
          {canItems ? (
            <Button variant="outline" size="sm" onClick={() => setItemSheet({})}>
              <PlusIcon /> Add line
            </Button>
          ) : null}
        </div>
        {load.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No freight lines.</p>
        ) : (
          <Table aria-label="Freight">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                {canItems ? <TableHead className="w-20" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {load.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="tabular text-right">{item.quantity !== null && item.quantity !== undefined ? `${formatNumber(item.quantity)} ${item.unit ?? ""}` : "—"}</TableCell>
                  <TableCell className="tabular text-right">{item.weight_lbs ? `${formatNumber(item.weight_lbs)} lb` : "—"}</TableCell>
                  {canItems ? (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" onClick={() => setItemSheet({ item })} aria-label={`Edit ${item.description}`}>
                        <PencilIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setRemoving({ kind: "item", item })} aria-label={`Remove ${item.description}`}>
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {showRates ? (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Rate and charges</h3>
            {canCharges ? (
              <Button variant="outline" size="sm" onClick={() => setChargeSheet({})}>
                <PlusIcon /> Add charge
              </Button>
            ) : null}
          </div>
          <Table aria-label="Rate and charges">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Charge</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {canCharges ? <TableHead className="w-20" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Line haul</TableCell>
                <TableCell className="tabular text-right">1</TableCell>
                <TableCell className="tabular text-right">{formatMoney(load.customer_rate, load.currency)}</TableCell>
                <TableCell className="tabular text-right">{formatMoney(load.customer_rate, load.currency)}</TableCell>
                {canCharges ? <TableCell /> : null}
              </TableRow>
              {load.charges.map((charge) => (
                <TableRow key={charge.id}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      {chargeLabel(charge.type)}
                      {!charge.billable ? <Badge>Not billed</Badge> : null}
                      {charge.driver_payable ? <Badge variant="info">Driver pay</Badge> : null}
                    </span>
                    {charge.description ? <span className="block text-xs text-muted-foreground">{charge.description}</span> : null}
                  </TableCell>
                  <TableCell className="tabular text-right">{Number(charge.quantity)}</TableCell>
                  <TableCell className="tabular text-right">{formatMoney(charge.rate, load.currency)}</TableCell>
                  <TableCell className="tabular text-right">{formatMoney(charge.amount, load.currency)}</TableCell>
                  {canCharges ? (
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon-sm" onClick={() => setChargeSheet({ charge })} aria-label={`Edit ${chargeLabel(charge.type)}`}>
                        <PencilIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setRemoving({ kind: "charge", charge })} aria-label={`Remove ${chargeLabel(charge.type)}`}>
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
              <TableRow className="font-semibold hover:bg-transparent">
                <TableCell colSpan={3}>Revenue</TableCell>
                <TableCell className="tabular text-right">{formatMoney(load.revenue, load.currency)}</TableCell>
                {canCharges ? <TableCell /> : null}
              </TableRow>
            </TableBody>
          </Table>
          {!canCharges && load.billing_status !== "unbilled" ? <p className="mt-2 text-xs text-muted-foreground">This load has been invoiced, so its charges are fixed. Void the invoice to change them.</p> : null}
        </section>
      ) : null}

      {chargeSheet ? <ChargeSheet load={load} charge={chargeSheet.charge} onOpenChange={(open) => !open && setChargeSheet(null)} /> : null}
      {itemSheet ? <ItemSheet load={load} item={itemSheet.item} onOpenChange={(open) => !open && setItemSheet(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.kind === "charge" ? `Remove ${chargeLabel(removing.charge.type)}?` : "Remove this freight line?"}
        description="This can't be undone."
        confirmLabel="Remove"
        destructive
        onConfirm={() => (removing ? remove.mutateAsync(removing) : Promise.resolve())}
      />
    </div>
  );
}

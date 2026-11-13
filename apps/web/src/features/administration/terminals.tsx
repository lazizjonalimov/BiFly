"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArchiveIcon, ArchiveRestoreIcon, PlusIcon, WarehouseIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DataTable, FilterSelect } from "@/components/data-table/data-table";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, TextField } from "@/components/forms/fields";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg } from "@/lib/auth/session";
import { place } from "@/lib/format/text";
import { blankToNull, optionalState, optionalText, requiredText } from "@/lib/validation";

type Terminal = Schema<"TerminalRead">;

const schema = z.object({
  name: requiredText("the terminal's name", 120),
  code: optionalText(20),
  address: optionalText(300),
  city: optionalText(80),
  state: optionalState,
  postal_code: optionalText(20),
  phone: optionalText(40),
});
type Values = z.infer<typeof schema>;
const defaults = (t?: Terminal): Values => ({ name: t?.name ?? "", code: t?.code ?? "", address: t?.address ?? "", city: t?.city ?? "", state: t?.state ?? "", postal_code: t?.postal_code ?? "", phone: t?.phone ?? "" });

function TerminalSheet({ open, onOpenChange, terminal }: { open: boolean; onOpenChange: (open: boolean) => void; terminal?: Terminal }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), values: open ? defaults(terminal) : undefined, defaultValues: defaults(terminal) });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (values: Values) => {
      const body = { ...blankToNull(values), name: values.name.trim(), state: values.state.trim().toUpperCase() || null };
      return terminal ? unwrap(api.PATCH("/api/v1/terminals/{item_id}", { params: { path: { item_id: terminal.id } }, body })) : unwrap(api.POST("/api/v1/terminals", { body }));
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: [org.id, "terminals"] });
      toast.success(terminal ? "Terminal saved" : `${saved.name} added`);
      form.reset(defaults(saved));
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });
  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(defaults(terminal));
          setFormError(null);
        }
        onOpenChange(next);
      }}
      title={terminal ? `Edit ${terminal.name}` : "New terminal"}
      description="A yard or office. Drivers, equipment and loads can be based at one, and lists can be filtered by it."
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={terminal ? "Save changes" : "Add terminal"}
    >
      <FieldGrid>
        <TextField control={form.control} name="name" label="Name" required autoFocus />
        <TextField control={form.control} name="code" label="Short code" hint="For example CHI" />
        <TextField control={form.control} name="address" label="Street address" className="sm:col-span-2" />
        <TextField control={form.control} name="city" label="City" />
        <div className="grid grid-cols-2 gap-4">
          <TextField control={form.control} name="state" label="State" maxLength={2} />
          <TextField control={form.control} name="postal_code" label="ZIP" />
        </div>
        <TextField control={form.control} name="phone" label="Phone" type="tel" autoComplete="off" />
      </FieldGrid>
    </EntitySheet>
  );
}

const FILTERS = { status: "active" };

export function Terminals() {
  const org = useOrg();
  const can = useCan();
  const queryClient = useQueryClient();
  const state = useListState({ defaultSort: "name", filters: FILTERS });
  const [sheet, setSheet] = useState<{ terminal?: Terminal } | null>(null);
  const canManage = can("organization.manage");

  const query = useQuery({
    queryKey: [org.id, "terminals", "list", state.apiParams],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/terminals", { params: { query: { ...state.apiParams, count: true } as never }, signal })),
    placeholderData: keepPreviousData,
  });

  const setStatus = useMutation({
    mutationFn: ({ terminal, action }: { terminal: Terminal; action: "archive" | "restore" }) =>
      unwrap(api.POST(action === "archive" ? "/api/v1/terminals/{item_id}/archive" : "/api/v1/terminals/{item_id}/restore", { params: { path: { item_id: terminal.id } } })),
    onSuccess: (saved) => {
      toast.success(saved.status === "archived" ? `${saved.name} archived` : `${saved.name} restored`);
      void queryClient.invalidateQueries({ queryKey: [org.id, "terminals"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const columns: ColumnDef<Terminal, unknown>[] = [
    {
      id: "name",
      header: "Terminal",
      enableSorting: true,
      enableHiding: false,
      cell: ({ row }) =>
        canManage ? (
          <button type="button" className="font-medium hover:underline" onClick={() => setSheet({ terminal: row.original })}>
            {row.original.name}
          </button>
        ) : (
          <span className="font-medium">{row.original.name}</span>
        ),
    },
    { id: "code", header: "Code", cell: ({ row }) => row.original.code ?? "—" },
    { id: "location", header: "Location", cell: ({ row }) => place(row.original.city, row.original.state) },
    { id: "phone", header: "Phone", cell: ({ row }) => row.original.phone ?? "—" },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ...(canManage
      ? ([
          {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            enableHiding: false,
            meta: { align: "right" },
            cell: ({ row }) => {
              const archived = row.original.status === "archived";
              return (
                <Button variant="ghost" size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ terminal: row.original, action: archived ? "restore" : "archive" })}>
                  {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />} {archived ? "Restore" : "Archive"}
                </Button>
              );
            },
          },
        ] satisfies ColumnDef<Terminal, unknown>[])
      : []),
  ];

  const newButton = canManage ? (
    <Button onClick={() => setSheet({})}>
      <PlusIcon /> New terminal
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Terminals" description="Your yards and offices. Use them to see only the drivers, equipment and loads of one location." actions={newButton} />
      <DataTable
        label="Terminals"
        columns={columns}
        query={query}
        state={state}
        getRowId={(row) => row.id}
        searchPlaceholder="Search name, code or city"
        filters={
          <FilterSelect
            label="Status"
            value={state.filters.status ?? "active"}
            onChange={(value) => state.setFilter("status", value)}
            options={[
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
              { value: "all", label: "All terminals" },
            ]}
          />
        }
        empty={{ icon: WarehouseIcon, title: "No terminals yet", description: "If you run from more than one yard, add each one here. A single-yard company doesn't need any.", action: newButton ?? undefined }}
      />
      <TerminalSheet open={sheet !== null} terminal={sheet?.terminal} onOpenChange={(open) => !open && setSheet(null)} />
    </>
  );
}

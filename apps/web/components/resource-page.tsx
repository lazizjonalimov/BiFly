"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { Page } from "@/lib/api";
import { label as humanize } from "@/lib/format";
import { useMe } from "@/lib/hooks";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "email" | "number" | "date" | "select" | "textarea";
  options?: string[];
  required?: boolean;
  half?: boolean;
  maxLength?: number;
};

export type ColumnDef<T> = { header: string; cell: (row: T) => ReactNode; right?: boolean };

type Row = { id: string } & Record<string, unknown>;

export function ResourceTable<T extends Row>({
  endpoint,
  noun,
  columns,
  fields,
  writePerm,
  defaults = {},
}: {
  endpoint: string;
  noun: string;
  columns: ColumnDef<T>[];
  fields: FieldDef[];
  writePerm: string;
  defaults?: Record<string, unknown>;
}) {
  const { can } = useMe();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<T | "new" | null>(null);

  const list = useQuery({
    queryKey: ["list", endpoint, q],
    queryFn: () => api.get<Page<T>>(`${endpoint}?limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: (prev) => prev,
  });
  const writable = can(writePerm);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["list"] });
    setEditing(null);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <Input
          type="search"
          placeholder={`Search ${noun}s…`}
          aria-label={`Search ${noun}s`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        {writable && (
          <Button variant="primary" onClick={() => setEditing("new")}>
            Add {noun}
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <div className="p-4">
          <ErrorNote error={list.error} />
        </div>
      ) : list.data!.items.length === 0 ? (
        <Empty>{q ? `No ${noun}s match “${q}”.` : `No ${noun}s yet.`}</Empty>
      ) : (
        <Table
          head={
            <>
              {columns.map((c) => (
                <Th key={c.header} right={c.right}>
                  {c.header}
                </Th>
              ))}
              {writable && <Th />}
            </>
          }
        >
          {list.data!.items.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50/60">
              {columns.map((c) => (
                <Td key={c.header} right={c.right}>
                  {c.cell(row)}
                </Td>
              ))}
              {writable && (
                <Td right>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                    Edit
                  </Button>
                </Td>
              )}
            </tr>
          ))}
        </Table>
      )}
      {list.data?.next_cursor && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing the first 200. Search to narrow.</p>}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? `Add ${noun}` : `Edit ${noun}`}>
        {editing !== null && (
          <ResourceForm
            key={editing === "new" ? "new" : editing.id}
            endpoint={endpoint}
            noun={noun}
            fields={fields}
            initial={editing === "new" ? defaults : editing}
            id={editing === "new" ? null : editing.id}
            onDone={done}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </Card>
  );
}

function ResourceForm({
  endpoint,
  noun,
  fields,
  initial,
  id,
  onDone,
  onCancel,
}: {
  endpoint: string;
  noun: string;
  fields: FieldDef[];
  initial: Record<string, unknown>;
  id: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, initial[f.name] == null ? "" : String(initial[f.name])])),
  );

  const payload = () =>
    Object.fromEntries(
      fields.map((f) => {
        const v = values[f.name].trim();
        if (v === "") return [f.name, null];
        return [f.name, f.type === "number" ? Number(v) : v];
      }),
    );

  const save = useMutation({
    mutationFn: () => (id ? api.patch(`${endpoint}/${id}`, payload()) : api.post(endpoint, payload())),
    onSuccess: onDone,
  });
  const remove = useMutation({ mutationFn: () => api.delete(`${endpoint}/${id}`), onSuccess: onDone });

  const error = save.error ?? remove.error;
  const fieldErrors = error instanceof ApiError ? error.fields : {};
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <Field key={f.name} label={f.label + (f.required ? "" : "")} error={fieldErrors[f.name]} className={f.half ? "" : "col-span-2"}>
            {(p) => {
              const common = {
                ...p,
                required: f.required,
                value: values[f.name],
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
                  setValues({ ...values, [f.name]: e.target.value }),
              };
              if (f.type === "select")
                return (
                  <Select {...common}>
                    {f.options!.map((o) => (
                      <option key={o} value={o}>
                        {humanize(o)}
                      </option>
                    ))}
                  </Select>
                );
              if (f.type === "textarea") return <Textarea {...common} maxLength={f.maxLength} />;
              return <Input {...common} type={f.type ?? "text"} maxLength={f.maxLength} />;
            }}
          </Field>
        ))}
      </div>
      {!hasFieldErrors && error ? (
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
      ) : null}
      <div className="mt-5 flex items-center justify-between gap-2">
        <div>
          {id && (
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => window.confirm(`Delete this ${noun}? This cannot be undone.`) && remove.mutate()}
            >
              Delete
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function ResourcePage<T extends Row>(props: Parameters<typeof ResourceTable<T>>[0] & { title: string; subtitle?: string }) {
  const { title, subtitle, ...rest } = props;
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <ResourceTable<T> {...rest} />
    </>
  );
}

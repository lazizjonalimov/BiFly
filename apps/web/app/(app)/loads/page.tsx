"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, Empty, ErrorNote, Input, Loading, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import type { Page } from "@/lib/api";
import { dateTime, label, money } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import type { LoadSummary } from "@/lib/types";

const STATUSES = ["pending", "assigned", "dispatched", "in_transit", "delivered", "completed", "invoiced", "paid", "cancelled"];

export default function LoadsPage() {
  const { can } = useMe();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [cursors, setCursors] = useState<string[]>([]); // stack of cursors for pages already visited
  const cursor = cursors[cursors.length - 1];

  const params = new URLSearchParams({ limit: "50" });
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  if (cursor) params.set("cursor", cursor);
  const list = useQuery({
    queryKey: ["list", "/loads", status, q, cursor ?? ""],
    queryFn: () => api.get<Page<LoadSummary>>(`/loads?${params}`),
    placeholderData: (prev) => prev,
  });
  const reset = () => setCursors([]);

  return (
    <>
      <PageHeader
        title="Loads"
        action={
          can("loads:write") && (
            <Link href="/loads/new">
              <Button variant="primary">New load</Button>
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 px-4 py-3">
          <Input
            type="search"
            placeholder="Search load #, reference, commodity…"
            aria-label="Search loads"
            className="max-w-xs"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              reset();
            }}
          />
          <Select
            aria-label="Filter by status"
            className="max-w-44"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              reset();
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4">
            <ErrorNote error={list.error} />
          </div>
        ) : list.data!.items.length === 0 ? (
          <Empty>{q || status ? "No loads match these filters." : "No loads yet. Create your first load to get started."}</Empty>
        ) : (
          <Table
            head={
              <>
                <Th>Load</Th>
                <Th>Status</Th>
                <Th>Customer</Th>
                <Th>Route</Th>
                <Th>Pickup</Th>
                <Th right>Rate</Th>
              </>
            }
          >
            {list.data!.items.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/60">
                <Td>
                  <Link href={`/loads/${l.id}`} className="font-medium text-brand-600 hover:underline">
                    {l.load_number}
                  </Link>
                  {l.reference && <div className="text-xs text-slate-500">Ref {l.reference}</div>}
                </Td>
                <Td>
                  <StatusBadge status={l.status} />
                </Td>
                <Td>{l.customer_name}</Td>
                <Td>
                  {l.origin} <span className="text-slate-400">→</span> {l.destination}
                </Td>
                <Td>{dateTime(l.pickup_at)}</Td>
                <Td right>{money(l.customer_rate)}</Td>
              </tr>
            ))}
          </Table>
        )}
        {(cursors.length > 0 || list.data?.next_cursor) && (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
            <Button size="sm" disabled={cursors.length === 0} onClick={() => setCursors(cursors.slice(0, -1))}>
              Previous
            </Button>
            <Button size="sm" disabled={!list.data?.next_cursor} onClick={() => setCursors([...cursors, list.data!.next_cursor!])}>
              Next
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

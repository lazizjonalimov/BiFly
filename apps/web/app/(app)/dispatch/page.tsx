"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AssignDialog } from "@/components/assign-dialog";
import { Button, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, label } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import type { Board, BoardCard } from "@/lib/types";

const COLUMNS = [
  { key: "pending", title: "Needs a driver" },
  { key: "assigned", title: "Assigned" },
  { key: "dispatched", title: "Dispatched" },
  { key: "in_transit", title: "In transit" },
  { key: "delivered", title: "Delivered — confirm" },
] as const;

export default function DispatchBoardPage() {
  const { can } = useMe();
  const qc = useQueryClient();
  const [assigning, setAssigning] = useState<BoardCard | null>(null);
  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => api.get<Board>("/dispatch/board"),
    refetchInterval: 30_000, // keep the board current while it's open on a dispatcher's screen
  });
  const dispatch = useMutation({
    mutationFn: (id: string) => api.post(`/dispatch/loads/${id}/dispatch`),
    onSuccess: () => qc.invalidateQueries(),
  });
  const canDispatch = can("dispatch:write");

  return (
    <>
      <PageHeader title="Dispatch board" subtitle="Open loads by stage. Refreshes automatically." />
      <ErrorNote error={board.error ?? dispatch.error} />
      {board.data?.truncated && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Showing the 500 oldest open loads. Use the Loads page to see the rest.
        </p>
      )}
      {board.isLoading ? (
        <Loading />
      ) : (
        <div className="mt-2 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const cards = board.data?.columns[col.key] ?? [];
            return (
              <section key={col.key} aria-label={col.title} className="rounded-lg border border-slate-200 bg-slate-100/70">
                <h2 className="flex items-center justify-between px-3 py-2.5 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                  {col.title}
                  <span className="rounded-full bg-white px-2 py-0.5 text-slate-700 tabular-nums">{cards.length}</span>
                </h2>
                <ul className="space-y-2 px-2 pb-2">
                  {cards.length === 0 && <li className="px-2 py-4 text-center text-xs text-slate-400">None</li>}
                  {cards.map((c) => (
                    <li key={c.id} className="rounded-md border border-slate-200 bg-white p-3 shadow-xs">
                      <Link href={`/loads/${c.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                        {c.load_number}
                      </Link>
                      <p className="mt-1 text-sm text-slate-800">
                        {c.origin} <span className="text-slate-400">→</span> {c.destination}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {c.customer_name} · {dateTime(c.pickup_at)} · {label(c.equipment_type)}
                      </p>
                      {c.assignment && (
                        <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
                          {c.assignment.driver_name} · {c.assignment.vehicle_unit}
                          {c.assignment.trailer_unit ? ` / ${c.assignment.trailer_unit}` : ""}
                        </p>
                      )}
                      {canDispatch && col.key === "pending" && (
                        <Button size="sm" variant="primary" className="mt-2 w-full" onClick={() => setAssigning(c)}>
                          Assign
                        </Button>
                      )}
                      {canDispatch && col.key === "assigned" && (
                        <Button size="sm" className="mt-2 w-full" disabled={dispatch.isPending} onClick={() => dispatch.mutate(c.id)}>
                          Dispatch to driver
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <AssignDialog load={assigning} onClose={() => setAssigning(null)} />
    </>
  );
}

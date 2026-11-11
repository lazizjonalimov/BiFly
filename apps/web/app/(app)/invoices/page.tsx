"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Card, Empty, ErrorNote, Loading, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import type { Page } from "@/lib/api";
import { day, money } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export default function InvoicesPage() {
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["list", "/invoices", status],
    queryFn: () => api.get<Page<Invoice>>(`/invoices?limit=200${status ? `&status=${status}` : ""}`),
  });
  return (
    <>
      <PageHeader title="Invoices" subtitle="Invoices are created from completed loads" />
      <Card>
        <div className="border-b border-slate-200 px-4 py-3">
          <Select aria-label="Filter by status" className="max-w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All invoices</option>
            <option value="sent">Open</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </Select>
        </div>
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <div className="p-4">
            <ErrorNote error={list.error} />
          </div>
        ) : list.data!.items.length === 0 ? (
          <Empty>No invoices{status ? " match this filter" : " yet"}.</Empty>
        ) : (
          <Table
            head={
              <>
                <Th>Invoice</Th>
                <Th>Customer</Th>
                <Th>Load</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th right>Total</Th>
                <Th right>Balance</Th>
              </>
            }
          >
            {list.data!.items.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50/60">
                <Td>
                  <Link href={`/invoices/${i.id}`} className="font-medium text-brand-600 hover:underline">
                    {i.invoice_number}
                  </Link>
                </Td>
                <Td>{i.customer_name}</Td>
                <Td>
                  <Link href={`/loads/${i.load_id}`} className="hover:underline">
                    {i.load_number}
                  </Link>
                </Td>
                <Td>{day(i.issued_date)}</Td>
                <Td>{day(i.due_date)}</Td>
                <Td>
                  <StatusBadge status={i.overdue ? "overdue" : i.status} />
                </Td>
                <Td right>{money(i.total)}</Td>
                <Td right>{money(i.status === "void" ? 0 : i.balance)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

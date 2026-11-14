import type { Metadata } from "next";
import { ExpensesList } from "@/features/expenses/expenses-list";

export const metadata: Metadata = { title: "Expenses" };

export default function Page() {
  return <ExpensesList />;
}

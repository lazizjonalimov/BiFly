import { cn } from "@/lib/utils";

/** Label and value pairs for the read-only side of a record. An empty value shows as a dash, never blank. */
export function DescriptionList({ className, ...props }: React.ComponentProps<"dl">) {
  return <dl className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3", className)} {...props} />;
}

export function Detail({ label, children, className }: { label: string; children?: React.ReactNode; className?: string }) {
  const empty = children === null || children === undefined || children === "" || children === false;
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{empty ? <span className="text-muted-foreground">—</span> : children}</dd>
    </div>
  );
}

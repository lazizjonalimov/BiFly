"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon, ArrowRightLeftIcon, Building2Icon, CheckIcon, PlusIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { applyApiErrors } from "@/components/forms/api-errors";
import { FieldGrid, SelectField, TextField } from "@/components/forms/fields";
import { FormError, SubmitButton } from "@/components/forms/submit";
import { switchCompany } from "@/components/layout/company-switcher";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useSession } from "@/lib/auth/session";
import { formatDay } from "@/lib/format/dates";

type Company = Schema<"CompanyOut">;
type Created = Schema<"CompanyCreated">;
type Part = Schema<"CompanyCreate">["include"] extends (infer P)[] | undefined ? P : never;

const PARTS: { value: Part; label: string; hint: string }[] = [
  { value: "team", label: "Team", hint: "Everyone keeps the same role" },
  { value: "terminals", label: "Terminals", hint: "Yards and offices" },
  { value: "customers", label: "Customers", hint: "With contacts and addresses" },
  { value: "drivers", label: "Drivers", hint: "With qualification files" },
  { value: "vehicles", label: "Trucks", hint: "With expiry dates" },
  { value: "trailers", label: "Trailers", hint: "With expiry dates" },
];
const COPIED_LABELS: Record<string, [string, string]> = {
  team: ["team member", "team members"], terminals: ["terminal", "terminals"], customers: ["customer", "customers"],
  drivers: ["driver", "drivers"], vehicles: ["truck", "trucks"], trailers: ["trailer", "trailers"],
};

const schema = z.object({
  name: z.string().trim().min(2, "Enter the company's name").max(160),
  legal_name: z.string().trim().max(200),
  dot_number: z.string().trim().max(20),
  mc_number: z.string().trim().max(20),
  copy_from: z.string(),
});
type Values = z.infer<typeof schema>;

function AddCompanyDialog({ open, onOpenChange, companies, currentId }: { open: boolean; onOpenChange: (open: boolean) => void; companies: Company[]; currentId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "", legal_name: "", dot_number: "", mc_number: "", copy_from: currentId } });
  const [include, setInclude] = useState<Part[]>(PARTS.map((p) => p.value));
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [opening, setOpening] = useState(false);
  const copyFrom = useWatch({ control: form.control, name: "copy_from" });

  const create = useMutation({
    mutationFn: (values: Values) =>
      unwrap(
        api.POST("/api/v1/account/companies", {
          body: {
            name: values.name,
            legal_name: values.legal_name || null,
            dot_number: values.dot_number || null,
            mc_number: values.mc_number || null,
            copy_from: values.copy_from || null,
            include: values.copy_from ? include : [],
          },
        }),
      ),
    onSuccess: (company) => {
      setCreated(company);
      void queryClient.invalidateQueries({ queryKey: ["account", "companies"] });
      router.refresh(); // the company switcher reads the list from the server
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });

  function close(next: boolean) {
    if (create.isPending || opening) return;
    if (!next) {
      form.reset();
      setInclude(PARTS.map((p) => p.value));
      setFormError(null);
      setCreated(null);
    }
    onOpenChange(next);
  }

  if (created) {
    const copied = Object.entries(created.copied ?? {}).filter(([, count]) => count > 0);
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{created.name} is ready</DialogTitle>
            <DialogDescription>
              {copied.length
                ? `Copied ${copied.map(([key, count]) => `${count} ${COPIED_LABELS[key]?.[count === 1 ? 0 : 1] ?? key}`).join(", ")}. Loads and invoices are never copied: this company starts its own books.`
                : "It starts empty, with you as its owner."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)} disabled={opening}>
              Stay here
            </Button>
            <SubmitButton
              type="button"
              pending={opening}
              onClick={async () => {
                setOpening(true);
                try {
                  await switchCompany(created.id);
                } catch (error) {
                  toast.error(errorMessage(error));
                  setOpening(false);
                }
              }}
            >
              Open {created.name}
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const sources = companies.filter((c) => c.status === "active");
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a company</DialogTitle>
          <DialogDescription>A separate company with its own loads, invoices and compliance records. You become its owner.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => {
              setFormError(null);
              create.mutate(values);
            })}
            className="grid gap-4"
            noValidate
          >
            <FormError message={formError} />
            <FieldGrid>
              <TextField control={form.control} name="name" label="Company name" required autoFocus className="sm:col-span-2" />
              <TextField control={form.control} name="legal_name" label="Legal name" hint="As it should appear on invoices" className="sm:col-span-2" />
              <TextField control={form.control} name="dot_number" label="USDOT number" inputMode="numeric" />
              <TextField control={form.control} name="mc_number" label="MC number" />
            </FieldGrid>
            <SelectField control={form.control} name="copy_from" label="Start with a copy of" placeholder="Nothing: start empty" options={sources.map((c) => ({ value: c.id, label: c.name }))} hint="Copies are independent: later changes in one company don't affect the other." />
            {copyFrom ? (
              <fieldset className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm font-medium">What to copy</legend>
                {PARTS.map((part) => (
                  <div key={part.value} className="flex items-start gap-2.5">
                    <Checkbox id={`part-${part.value}`} className="mt-0.5" checked={include.includes(part.value)} onCheckedChange={(checked) => setInclude((current) => (checked === true ? [...current, part.value] : current.filter((p) => p !== part.value)))} />
                    <div>
                      <Label htmlFor={`part-${part.value}`} className="leading-5 font-normal">
                        {part.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">{part.hint}</p>
                    </div>
                  </div>
                ))}
              </fieldset>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)} disabled={create.isPending}>
                Cancel
              </Button>
              <SubmitButton pending={create.isPending}>Add company</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function Companies() {
  const { organization } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<{ company: Company; action: "archive" | "restore" } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["account", "companies"], queryFn: () => unwrap(api.GET("/api/v1/account/companies")) });

  // "Add a company" in the company switcher lands here with ?new=1.
  const wantsNew = search.get("new") === "1";
  const addOpen = adding || wantsNew;
  function setAddOpen(next: boolean) {
    setAdding(next);
    if (!next && wantsNew) router.replace(pathname);
  }

  const setStatus = useMutation({
    mutationFn: ({ company, action }: { company: Company; action: "archive" | "restore" }) =>
      unwrap(api.POST(action === "archive" ? "/api/v1/account/companies/{company_id}/archive" : "/api/v1/account/companies/{company_id}/restore", { params: { path: { company_id: company.id } } })),
    onSuccess: (company, { action }) => {
      toast.success(action === "archive" ? `${company.name} archived` : `${company.name} restored`);
      void queryClient.invalidateQueries({ queryKey: ["account", "companies"] });
      router.refresh();
    },
  });

  async function open(company: Company) {
    setSwitching(company.id);
    try {
      await switchCompany(company.id);
    } catch (error) {
      toast.error(errorMessage(error));
      setSwitching(null);
    }
  }

  const data = query.data;
  const atLimit = data ? data.active_count >= data.max_companies : false;
  const addButton = (
    <Button onClick={() => setAddOpen(true)} disabled={!data || atLimit}>
      <PlusIcon /> Add company
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Companies"
        description={data ? `${data.active_count} of ${data.max_companies} active companies in your profile. Archived companies don't count.` : "The companies you run from this profile."}
        actions={
          atLimit ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{addButton}</span>
              </TooltipTrigger>
              <TooltipContent>You have reached {data?.max_companies} active companies. Archive one you no longer operate to add another.</TooltipContent>
            </Tooltip>
          ) : (
            addButton
          )
        }
      />

      {query.isPending ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Loading companies">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Card>
      ) : data && data.companies.length === 0 ? (
        <Card>
          <EmptyState icon={Building2Icon} title="No companies yet" />
        </Card>
      ) : (
        <ul className="grid gap-3">
          {data?.companies.map((company) => {
            const current = company.id === organization.id;
            const archived = company.status === "archived";
            return (
              <li key={company.id}>
                <Card className="flex flex-wrap items-center gap-4 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{company.name}</span>
                      {current ? (
                        <Badge variant="default">
                          <CheckIcon /> You are here
                        </Badge>
                      ) : null}
                      {archived ? <Badge variant="warning">Archived · read-only</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {[company.dot_number ? `USDOT ${company.dot_number}` : null, company.mc_number ? `MC ${company.mc_number}` : null, `Added ${formatDay(company.created_at, organization.timezone)}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!current ? (
                      <SubmitButton type="button" variant="outline" size="sm" pending={switching === company.id} disabled={switching !== null} onClick={() => open(company)}>
                        <ArrowRightLeftIcon /> Switch to it
                      </SubmitButton>
                    ) : null}
                    {archived ? (
                      <Button variant="outline" size="sm" onClick={() => setTarget({ company, action: "restore" })}>
                        <ArchiveRestoreIcon /> Restore
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setTarget({ company, action: "archive" })}>
                        <ArchiveIcon /> Archive
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {data ? <AddCompanyDialog open={addOpen} onOpenChange={setAddOpen} companies={data.companies} currentId={organization.id} /> : null}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={target?.action === "archive" ? `Archive ${target.company.name}?` : `Restore ${target?.company.name}?`}
        description={
          target?.action === "archive"
            ? "Its loads, invoices and records stay readable, but nothing in it can be changed until it is restored. It stops counting toward your limit of active companies."
            : "It becomes a working company again and counts toward your limit of active companies."
        }
        confirmLabel={target?.action === "archive" ? "Archive company" : "Restore company"}
        destructive={target?.action === "archive"}
        onConfirm={() => (target ? setStatus.mutateAsync(target) : Promise.resolve())}
      />
    </>
  );
}

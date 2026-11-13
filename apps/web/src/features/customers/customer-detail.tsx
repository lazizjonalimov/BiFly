"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon, MailIcon, MapPinIcon, PencilIcon, PhoneIcon, PlusIcon, Trash2Icon, UserIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { CheckboxField, FieldGrid, SelectField, TextField, TextareaField } from "@/components/forms/fields";
import { useBreadcrumbLabel } from "@/components/layout/breadcrumbs";
import { DescriptionList, Detail } from "@/components/layout/description-list";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerSheet } from "@/features/customers/customer-sheet";
import { DocumentsPanel } from "@/features/documents/documents-panel";
import { RelatedInvoices } from "@/features/finance/related-invoices";
import { RelatedLoads } from "@/features/loads/related-loads";
import { api, unwrap } from "@/lib/api/client";
import type { Schema } from "@/lib/api/types";
import { useCan, useOrg } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format/money";
import { formatNumber, humanize, place } from "@/lib/format/text";
import { blankToNull, optionalEmail, optionalState, optionalText, requiredText } from "@/lib/validation";

type Customer = Schema<"CustomerDetail">;
type Contact = Schema<"ContactRead">;
type Address = Schema<"AddressRead">;

// ---------------------------------------------------------------- contacts
const contactSchema = z.object({
  name: requiredText("the contact's name", 120),
  title: optionalText(80),
  email: optionalEmail,
  phone: optionalText(40),
  kind: z.enum(["operations", "billing", "other"]),
  is_primary: z.boolean(),
});
type ContactValues = z.infer<typeof contactSchema>;
const contactDefaults = (c?: Contact): ContactValues => ({ name: c?.name ?? "", title: c?.title ?? "", email: c?.email ?? "", phone: c?.phone ?? "", kind: c?.kind ?? "operations", is_primary: c?.is_primary ?? false });

function ContactSheet({ customerId, contact, open, onOpenChange, onSaved }: { customerId: string; contact?: Contact; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const form = useForm<ContactValues>({ resolver: zodResolver(contactSchema), values: open ? contactDefaults(contact) : undefined, defaultValues: contactDefaults(contact) });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (values: ContactValues) => {
      const body = blankToNull(values) as Schema<"ContactCreate">;
      return contact
        ? unwrap(api.PATCH("/api/v1/customers/{parent_id}/contacts/{item_id}", { params: { path: { parent_id: customerId, item_id: contact.id } }, body }))
        : unwrap(api.POST("/api/v1/customers/{parent_id}/contacts", { params: { path: { parent_id: customerId } }, body }));
    },
    onSuccess: () => {
      toast.success(contact ? "Contact saved" : "Contact added");
      onSaved();
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });
  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setFormError(null);
        onOpenChange(next);
      }}
      title={contact ? `Edit ${contact.name}` : "New contact"}
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={contact ? "Save changes" : "Add contact"}
    >
      <FieldGrid>
        <TextField control={form.control} name="name" label="Name" required autoFocus />
        <TextField control={form.control} name="title" label="Job title" />
        <TextField control={form.control} name="email" label="Email" type="email" autoComplete="off" />
        <TextField control={form.control} name="phone" label="Phone" type="tel" autoComplete="off" />
        <SelectField
          control={form.control}
          name="kind"
          label="Handles"
          options={[
            { value: "operations", label: "Operations: pickups and deliveries" },
            { value: "billing", label: "Billing: invoices and payments" },
            { value: "other", label: "Something else" },
          ]}
          className="sm:col-span-2"
        />
        <CheckboxField control={form.control} name="is_primary" label="Main contact" hint="Shown first. A customer has one main contact." className="sm:col-span-2" />
      </FieldGrid>
    </EntitySheet>
  );
}

// ---------------------------------------------------------------- addresses
const addressSchema = z.object({
  label: requiredText("a name for this place", 120),
  kind: z.enum(["facility", "billing"]),
  address: optionalText(300),
  city: requiredText("the city", 80),
  state: optionalState,
  postal_code: optionalText(20),
  contact_name: optionalText(120),
  contact_phone: optionalText(40),
  notes: optionalText(500),
});
type AddressValues = z.infer<typeof addressSchema>;
const addressDefaults = (a?: Address): AddressValues => ({
  label: a?.label ?? "", kind: a?.kind ?? "facility", address: a?.address ?? "", city: a?.city ?? "", state: a?.state ?? "",
  postal_code: a?.postal_code ?? "", contact_name: a?.contact_name ?? "", contact_phone: a?.contact_phone ?? "", notes: a?.notes ?? "",
});

function AddressSheet({ customerId, address, open, onOpenChange, onSaved }: { customerId: string; address?: Address; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const form = useForm<AddressValues>({ resolver: zodResolver(addressSchema), values: open ? addressDefaults(address) : undefined, defaultValues: addressDefaults(address) });
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (values: AddressValues) => {
      const body = { ...blankToNull(values), state: values.state.trim().toUpperCase() || null } as Schema<"AddressCreate">;
      return address
        ? unwrap(api.PATCH("/api/v1/customers/{parent_id}/addresses/{item_id}", { params: { path: { parent_id: customerId, item_id: address.id } }, body }))
        : unwrap(api.POST("/api/v1/customers/{parent_id}/addresses", { params: { path: { parent_id: customerId } }, body }));
    },
    onSuccess: () => {
      toast.success(address ? "Address saved" : "Address added");
      onSaved();
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });
  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setFormError(null);
        onOpenChange(next);
      }}
      title={address ? `Edit ${address.label}` : "New address"}
      description="A place this customer ships from or to, or where invoices go."
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        save.mutate(values);
      }}
      pending={save.isPending}
      formError={formError}
      submitLabel={address ? "Save changes" : "Add address"}
    >
      <FieldGrid>
        <TextField control={form.control} name="label" label="Name of the place" required autoFocus hint="For example: Plant 4, Dock 12" />
        <SelectField
          control={form.control}
          name="kind"
          label="Used for"
          options={[
            { value: "facility", label: "Pickups and deliveries" },
            { value: "billing", label: "Billing" },
          ]}
        />
        <TextField control={form.control} name="address" label="Street address" className="sm:col-span-2" />
        <TextField control={form.control} name="city" label="City" required />
        <div className="grid grid-cols-2 gap-4">
          <TextField control={form.control} name="state" label="State" maxLength={2} />
          <TextField control={form.control} name="postal_code" label="ZIP" />
        </div>
        <TextField control={form.control} name="contact_name" label="Who to ask for" />
        <TextField control={form.control} name="contact_phone" label="Their phone" type="tel" autoComplete="off" />
        <TextareaField control={form.control} name="notes" label="Notes for drivers" rows={3} className="sm:col-span-2" hint="Gate codes, dock hours, where to check in" />
      </FieldGrid>
    </EntitySheet>
  );
}

// ---------------------------------------------------------------- page
type Editing = { kind: "contact"; item?: Contact } | { kind: "address"; item?: Address } | null;
type Removing = { kind: "contact"; item: Contact } | { kind: "address"; item: Address } | null;

export function CustomerDetail({ id }: { id: string }) {
  const org = useOrg();
  const can = useCan();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [sub, setSub] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Removing>(null);
  const [archiving, setArchiving] = useState(false);

  const queryKey = [org.id, "customers", "detail", id];
  const query = useQuery({ queryKey, queryFn: () => unwrap(api.GET("/api/v1/customers/{customer_id}", { params: { path: { customer_id: id } } })) });
  const customer: Customer | undefined = query.data;
  useBreadcrumbLabel(customer?.name);
  const refresh = () => queryClient.invalidateQueries({ queryKey: [org.id, "customers"] });

  const setStatus = useMutation({
    mutationFn: (action: "archive" | "restore") =>
      unwrap(api.POST(action === "archive" ? "/api/v1/customers/{item_id}/archive" : "/api/v1/customers/{item_id}/restore", { params: { path: { item_id: id } } })),
    onSuccess: (saved) => {
      toast.success(saved.status === "archived" ? `${saved.name} archived` : `${saved.name} restored`);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (target: NonNullable<Removing>) =>
      unwrap(
        target.kind === "contact"
          ? api.DELETE("/api/v1/customers/{parent_id}/contacts/{item_id}", { params: { path: { parent_id: id, item_id: target.item.id } } })
          : api.DELETE("/api/v1/customers/{parent_id}/addresses/{item_id}", { params: { path: { parent_id: id, item_id: target.item.id } } }),
      ),
    onSuccess: () => {
      toast.success("Removed");
      void refresh();
    },
  });

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading customer">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (query.isError || !customer) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }

  const canManage = can("customers.manage");
  const archived = customer.status === "archived";
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {customer.name} <StatusBadge status={customer.status} />
          </span>
        }
        description={[customer.code, customer.legal_name].filter(Boolean).join(" · ") || undefined}
        actions={
          canManage ? (
            <>
              <Button variant="outline" onClick={() => (archived ? setStatus.mutate("restore") : setArchiving(true))} disabled={setStatus.isPending}>
                {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />} {archived ? "Restore" : "Archive"}
              </Button>
              <Button onClick={() => setEditing(true)}>
                <PencilIcon /> Edit
              </Button>
            </>
          ) : null
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open loads" value={formatNumber(customer.stats.loads_open)} />
        <Stat label="Loads in total" value={formatNumber(customer.stats.loads_total)} />
        {customer.stats.open_balance !== null && customer.stats.open_balance !== undefined ? <Stat label="Owes you" value={formatMoney(customer.stats.open_balance, customer.stats.currency ?? "USD")} /> : null}
        <Stat label="Payment terms" value={`Net ${customer.payment_terms_days}`} />
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="contacts">
            Contacts <Badge>{customer.contacts.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="addresses">
            Addresses <Badge>{customer.addresses.length}</Badge>
          </TabsTrigger>
          {can("loads.read") ? <TabsTrigger value="loads">Loads</TabsTrigger> : null}
          {can("invoices.read") ? <TabsTrigger value="invoices">Invoices</TabsTrigger> : null}
          {can("documents.read") ? <TabsTrigger value="documents">Documents</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardContent>
              <DescriptionList>
                <Detail label="Legal name">{customer.legal_name}</Detail>
                <Detail label="Short code">{customer.code}</Detail>
                <Detail label="Phone">{customer.phone}</Detail>
                <Detail label="Billing email">{customer.billing_email}</Detail>
                <Detail label="Billing address">{[customer.billing_address, place(customer.billing_city, customer.billing_state) === "—" ? null : place(customer.billing_city, customer.billing_state), customer.billing_postal_code].filter(Boolean).join(", ")}</Detail>
                <Detail label="Credit limit">{customer.credit_limit ? formatMoney(customer.credit_limit, org.base_currency) : null}</Detail>
                <Detail label="Notes" className="sm:col-span-2 lg:col-span-3">
                  {customer.notes ? <span className="whitespace-pre-wrap">{customer.notes}</span> : null}
                </Detail>
              </DescriptionList>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            {customer.contacts.length === 0 ? (
              <EmptyState icon={UserIcon} title="No contacts yet" description="Add who to call about a load, and who pays the invoices." action={canManage ? <AddButton onClick={() => setSub({ kind: "contact" })}>Add contact</AddButton> : undefined} />
            ) : (
              <>
                <ul className="divide-y">
                  {customer.contacts.map((contact) => (
                    <li key={contact.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {contact.name}
                          {contact.is_primary ? <Badge variant="default">Main contact</Badge> : null}
                          <Badge>{humanize(contact.kind)}</Badge>
                        </p>
                        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          {contact.title ? <span>{contact.title}</span> : null}
                          {contact.email ? (
                            <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                              <MailIcon className="size-3.5" /> {contact.email}
                            </a>
                          ) : null}
                          {contact.phone ? (
                            <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                              <PhoneIcon className="size-3.5" /> {contact.phone}
                            </a>
                          ) : null}
                        </p>
                      </div>
                      {canManage ? <RowActions name={contact.name} onEdit={() => setSub({ kind: "contact", item: contact })} onRemove={() => setRemoving({ kind: "contact", item: contact })} /> : null}
                    </li>
                  ))}
                </ul>
                {canManage ? (
                  <div className="border-t p-3">
                    <AddButton onClick={() => setSub({ kind: "contact" })}>Add contact</AddButton>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="addresses">
          <Card>
            {customer.addresses.length === 0 ? (
              <EmptyState icon={MapPinIcon} title="No addresses yet" description="Save the places this customer ships from and to, so booking a load is a pick from a list." action={canManage ? <AddButton onClick={() => setSub({ kind: "address" })}>Add address</AddButton> : undefined} />
            ) : (
              <>
                <ul className="divide-y">
                  {customer.addresses.map((address) => (
                    <li key={address.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {address.label} <Badge>{address.kind === "billing" ? "Billing" : "Pickups and deliveries"}</Badge>
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{[address.address, place(address.city, address.state), address.postal_code].filter(Boolean).join(", ")}</p>
                        {address.contact_name || address.contact_phone ? <p className="text-sm text-muted-foreground">Ask for {[address.contact_name, address.contact_phone].filter(Boolean).join(", ")}</p> : null}
                        {address.notes ? <p className="mt-1 text-sm whitespace-pre-wrap">{address.notes}</p> : null}
                      </div>
                      {canManage ? <RowActions name={address.label} onEdit={() => setSub({ kind: "address", item: address })} onRemove={() => setRemoving({ kind: "address", item: address })} /> : null}
                    </li>
                  ))}
                </ul>
                {canManage ? (
                  <div className="border-t p-3">
                    <AddButton onClick={() => setSub({ kind: "address" })}>Add address</AddButton>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </TabsContent>
        {can("loads.read") ? (
          <TabsContent value="loads">
            <Card>
              <RelatedLoads filter={{ customer_id: customer.id }} emptyText="No loads booked for this customer yet." />
            </Card>
          </TabsContent>
        ) : null}
        {can("invoices.read") ? (
          <TabsContent value="invoices">
            <Card>
              <RelatedInvoices customerId={customer.id} />
            </Card>
          </TabsContent>
        ) : null}
        {can("documents.read") ? (
          <TabsContent value="documents">
            <Card>
              <DocumentsPanel entityType="customer" entityId={customer.id} types={["rate_confirmation", "other"]} emptyHint="Keep the carrier agreement, credit application and standing rate confirmations here." />
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      <CustomerSheet open={editing} onOpenChange={setEditing} customer={customer} />
      <ContactSheet customerId={id} open={sub?.kind === "contact"} contact={sub?.kind === "contact" ? sub.item : undefined} onOpenChange={(open) => !open && setSub(null)} onSaved={refresh} />
      <AddressSheet customerId={id} open={sub?.kind === "address"} address={sub?.kind === "address" ? sub.item : undefined} onOpenChange={(open) => !open && setSub(null)} onSaved={refresh} />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${customer.name}?`}
        description="It disappears from pickers and can't be booked on new loads. Its loads and invoices stay exactly as they are, and you can restore it at any time."
        confirmLabel="Archive customer"
        destructive
        onConfirm={() => setStatus.mutateAsync("archive")}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.kind === "contact" ? removing.item.name : removing?.item.label}?`}
        description="This can't be undone."
        confirmLabel="Remove"
        destructive
        onConfirm={() => (removing ? remove.mutateAsync(removing) : Promise.resolve())}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <PlusIcon /> {children}
    </Button>
  );
}

function RowActions({ name, onEdit, onRemove }: { name: string; onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="flex gap-1">
      <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit ${name}`}>
        <PencilIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${name}`}>
        <Trash2Icon />
      </Button>
    </div>
  );
}

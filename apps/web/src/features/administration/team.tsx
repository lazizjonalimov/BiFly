"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, UserCheckIcon, UserXIcon } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/states";
import { applyApiErrors } from "@/components/forms/api-errors";
import { EntitySheet } from "@/components/forms/entity-sheet";
import { FieldGrid, SelectField, TextField } from "@/components/forms/fields";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import type { Schema } from "@/lib/api/types";
import { useOrg, useSession } from "@/lib/auth/session";
import { requiredText } from "@/lib/validation";

type Member = Schema<"MemberOut">;
type RoleKey = Schema<"Role">;
type RoleInfo = Schema<"RoleOut">;

const schema = z.object({
  full_name: requiredText("their name", 120),
  email: z.email("Enter a valid email address"),
  role: z.string().min(1, "Choose a role"),
  // Needed only for someone who has never signed in to BiFly; the API says so if it is missing.
  password: z.union([z.literal(""), z.string().min(10, "Use at least 10 characters").max(200)]),
});
type Values = z.infer<typeof schema>;
const EMPTY: Values = { full_name: "", email: "", role: "dispatcher", password: "" };

function AddMemberSheet({ open, onOpenChange, roles }: { open: boolean; onOpenChange: (open: boolean) => void; roles: RoleInfo[] }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const [formError, setFormError] = useState<string | null>(null);
  const role = useWatch({ control: form.control, name: "role" });
  const chosen = roles.find((r) => r.key === role);

  const add = useMutation({
    mutationFn: (values: Values) => unwrap(api.POST("/api/v1/members", { body: { full_name: values.full_name.trim(), email: values.email, role: values.role as RoleKey, password: values.password || null } })),
    onSuccess: (member) => {
      void queryClient.invalidateQueries({ queryKey: [org.id, "members"] });
      toast.success(`${member.full_name} added to the team`);
      form.reset(EMPTY);
      onOpenChange(false);
    },
    onError: (error) => setFormError(applyApiErrors(form, error)),
  });

  return (
    <EntitySheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset(EMPTY);
          setFormError(null);
        }
        onOpenChange(next);
      }}
      title="Add a team member"
      description={`They will be able to sign in and work in ${org.name}.`}
      form={form}
      onSubmit={(values) => {
        setFormError(null);
        add.mutate(values);
      }}
      pending={add.isPending}
      formError={formError}
      submitLabel="Add to team"
    >
      <FieldGrid>
        <TextField control={form.control} name="full_name" label="Name" required autoFocus />
        <TextField control={form.control} name="email" label="Email" type="email" required autoComplete="off" />
        <SelectField control={form.control} name="role" label="Role" required options={roles.filter((r) => r.assignable).map((r) => ({ value: r.key, label: r.label }))} hint={chosen?.description} className="sm:col-span-2" />
        <TextField
          control={form.control}
          name="password"
          label="Temporary password"
          type="password"
          autoComplete="new-password"
          className="sm:col-span-2"
          hint="For someone new to BiFly: give it to them, and they can change it after signing in. Leave empty for someone who already has a BiFly sign-in; they keep their own password."
        />
      </FieldGrid>
    </EntitySheet>
  );
}

export function Team() {
  const org = useOrg();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [deactivating, setDeactivating] = useState<Member | null>(null);

  const members = useQuery({ queryKey: [org.id, "members"], queryFn: () => unwrap(api.GET("/api/v1/members")) });
  const roles = useQuery({ queryKey: [org.id, "roles"], queryFn: () => unwrap(api.GET("/api/v1/roles")), staleTime: 10 * 60_000 });
  const roleList = roles.data?.roles ?? [];
  const label = (key: string) => roleList.find((r) => r.key === key)?.label ?? key;

  const update = useMutation({
    mutationFn: ({ member, change }: { member: Member; change: Schema<"MemberPatch"> }) => unwrap(api.PATCH("/api/v1/members/{user_id}", { params: { path: { user_id: member.user_id } }, body: change })),
    onSuccess: (saved, { change }) => {
      toast.success(change.role ? `${saved.full_name} is now ${label(saved.role)}` : saved.active ? `${saved.full_name} can sign in again` : `${saved.full_name} can no longer sign in`);
      void queryClient.invalidateQueries({ queryKey: [org.id, "members"] });
    },
  });

  return (
    <>
      <PageHeader
        title="Team"
        description={`Who can sign in to ${org.name}, and what their role lets them do. Changes take effect at once.`}
        actions={
          <Button onClick={() => setAdding(true)} disabled={roles.isPending}>
            <PlusIcon /> Add team member
          </Button>
        }
      />
      <Card>
        {members.isPending ? (
          <div className="grid gap-2 p-5" aria-busy="true" aria-label="Loading team">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : (
          <Table aria-label="Team members">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="rounded-tl-xl">Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="rounded-tr-xl text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data.map((member) => {
                const self = member.user_id === user.id;
                return (
                  <TableRow key={member.user_id}>
                    <TableCell className="font-medium">
                      {member.full_name} {self ? <Badge className="ml-1">You</Badge> : null}
                    </TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      {self ? (
                        label(member.role)
                      ) : (
                        <NativeSelect
                          aria-label={`Role of ${member.full_name}`}
                          wrapperClassName="w-48"
                          value={member.role}
                          disabled={update.isPending || !member.active}
                          onChange={(event) =>
                            update.mutate(
                              { member, change: { role: event.target.value as RoleKey } },
                              { onError: (error) => toast.error(errorMessage(error)) },
                            )
                          }
                        >
                          {roleList
                            .filter((r) => r.assignable || r.key === member.role)
                            .map((r) => (
                              <option key={r.key} value={r.key}>
                                {r.label}
                              </option>
                            ))}
                        </NativeSelect>
                      )}
                    </TableCell>
                    <TableCell>{member.active ? <Badge variant="success">Can sign in</Badge> : <Badge>Deactivated</Badge>}</TableCell>
                    <TableCell className="text-right">
                      {self ? null : member.active ? (
                        <Button variant="ghost" size="sm" onClick={() => setDeactivating(member)}>
                          <UserXIcon /> Deactivate
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => update.mutate({ member, change: { active: true } }, { onError: (error) => toast.error(errorMessage(error)) })}>
                          <UserCheckIcon /> Reactivate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <AddMemberSheet open={adding} onOpenChange={setAdding} roles={roleList} />
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={`Deactivate ${deactivating?.full_name}?`}
        description={`They are signed out of ${org.name} immediately and can't sign back in to it. Everything they did stays on record, and you can reactivate them at any time.`}
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => (deactivating ? update.mutateAsync({ member: deactivating, change: { active: false } }) : Promise.resolve())}
      />
    </>
  );
}

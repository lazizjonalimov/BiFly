"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { label } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import type { Member } from "@/lib/types";

const ROLES = ["owner", "admin", "dispatcher", "safety_manager", "fleet_manager", "accountant", "driver"];
const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including ownership changes",
  admin: "Everything except granting ownership",
  dispatcher: "Loads, assignments, customers",
  safety_manager: "Driver qualification and documents",
  fleet_manager: "Trucks and trailers",
  accountant: "Invoices and payments",
  driver: "Driver mobile app only",
};

export default function TeamPage() {
  const { me } = useMe();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<Member[]>("/users") });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Member> }) => api.patch(`/users/${id}`, body),
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
  const roleOptions = ROLES.filter((r) => r !== "owner" || me?.role === "owner");

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="People who can sign in to your company"
        action={
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add user
          </Button>
        }
      />
      <ErrorNote error={patch.error} />
      <Card className="mt-2">
        {users.isLoading ? (
          <Loading />
        ) : users.error ? (
          <div className="p-4">
            <ErrorNote error={users.error} />
          </div>
        ) : (
          <Table
            head={
              <>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Access</Th>
                <Th />
              </>
            }
          >
            {users.data!.map((u) => {
              const self = u.user_id === me?.user_id;
              const locked = self || (u.role === "owner" && me?.role !== "owner");
              return (
                <tr key={u.user_id}>
                  <Td className="font-medium text-slate-900">
                    {u.full_name} {self && <span className="font-normal text-slate-400">(you)</span>}
                  </Td>
                  <Td>{u.email}</Td>
                  <Td>
                    <Select
                      aria-label={`Role for ${u.full_name}`}
                      className="max-w-44 min-w-36"
                      disabled={locked || patch.isPending}
                      value={u.role}
                      onChange={(e) => patch.mutate({ id: u.user_id, body: { role: e.target.value } })}
                    >
                      {(locked ? ROLES : roleOptions).map((r) => (
                        <option key={r} value={r}>
                          {label(r)}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Badge tone={u.active ? "green" : "slate"}>{u.active ? "Active" : "Deactivated"}</Badge>
                  </Td>
                  <Td right>
                    {!locked && (
                      <Button size="sm" variant="ghost" disabled={patch.isPending} onClick={() => patch.mutate({ id: u.user_id, body: { active: !u.active } })}>
                        {u.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add user">
        {adding && (
          <AddUser
            roles={roleOptions}
            onDone={() => {
              qc.invalidateQueries({ queryKey: ["users"] });
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </Modal>
    </>
  );
}

function AddUser({ roles, onDone, onCancel }: { roles: string[]; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "dispatcher" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const create = useMutation({ mutationFn: () => api.post("/users", form), onSuccess: onDone });
  const fe = create.error instanceof ApiError ? create.error.fields : {};
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Field label="Full name" error={fe.full_name}>
        {(p) => <Input {...p} required maxLength={120} value={form.full_name} onChange={set("full_name")} />}
      </Field>
      <Field label="Email" error={fe.email}>
        {(p) => <Input {...p} type="email" required autoComplete="off" value={form.email} onChange={set("email")} />}
      </Field>
      <Field label="Temporary password" error={fe.password} hint="At least 10 characters. Share it with them securely.">
        {(p) => <Input {...p} type="text" required minLength={10} autoComplete="off" value={form.password} onChange={set("password")} />}
      </Field>
      <Field label="Role" error={fe.role} hint={ROLE_HELP[form.role]}>
        {(p) => (
          <Select {...p} value={form.role} onChange={set("role")}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <ErrorNote error={Object.keys(fe).length ? null : create.error} />
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? "Adding…" : "Add user"}
        </Button>
      </div>
    </form>
  );
}

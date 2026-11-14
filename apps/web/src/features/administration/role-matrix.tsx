"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, MinusIcon } from "lucide-react";
import { Fragment } from "react";
import { ErrorState } from "@/components/feedback/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, unwrap } from "@/lib/api/client";
import { useOrg, useSession } from "@/lib/auth/session";

/** What each role can do, permission by permission. The API checks exactly these on every request. */
export function RoleMatrix() {
  const org = useOrg();
  const me = useSession();
  const query = useQuery({ queryKey: [org.id, "roles"], queryFn: () => unwrap(api.GET("/api/v1/roles")), staleTime: 300_000 });
  const myRole = me.organization.role;

  return (
    <>
      <PageHeader title="Roles" description="Each person has one role in each company. Change someone's role under Team." />
      {query.isPending ? (
        <Skeleton className="h-96" />
      ) : query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {query.data.roles.map((role) => (
              <div key={role.key} className="rounded-lg border bg-card p-3 text-sm shadow-xs">
                <p className="flex items-center gap-2 font-medium">
                  {role.label} {role.key === myRole ? <Badge variant="info">You</Badge> : null}
                </p>
                <p className="text-muted-foreground">{role.description}</p>
              </div>
            ))}
          </div>
          <Card className="min-w-0">
            <Table aria-label="What each role can do">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 z-10 min-w-56 bg-muted">Permission</TableHead>
                  {query.data.roles.map((role) => (
                    <TableHead key={role.key} className="text-center">
                      {role.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.groups.map((group) => (
                  <Fragment key={group.name}>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={query.data.roles.length + 1} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {group.name}
                      </TableCell>
                    </TableRow>
                    {group.permissions.map((permission) => (
                      <TableRow key={permission.key}>
                        <TableCell className="sticky left-0 z-10 bg-card">{permission.label}</TableCell>
                        {query.data.roles.map((role) => {
                          const allowed = role.permissions.includes(permission.key);
                          return (
                            <TableCell key={role.key} className="text-center">
                              {allowed ? <CheckIcon className="mx-auto size-4 text-success" aria-label="Allowed" /> : <MinusIcon className="mx-auto size-4 text-muted-foreground/50" aria-label="Not allowed" />}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, ErrorNote, Field, Modal, Select } from "@/components/ui";
import { api, newKey } from "@/lib/api";
import { label } from "@/lib/format";
import { useList } from "@/lib/hooks";
import type { Driver, LoadDetail, Trailer, Vehicle } from "@/lib/types";

/** Pick a driver, truck and trailer for a load. The API enforces compliance and availability. */
export function AssignDialog({
  load,
  onClose,
}: {
  load: { id: string; load_number: string; equipment_type: string } | null;
  onClose: () => void;
}) {
  return (
    <Modal open={load !== null} onClose={onClose} title={load ? `Assign ${load.load_number}` : "Assign"}>
      {load && <AssignForm key={load.id} load={load} onClose={onClose} />}
    </Modal>
  );
}

function AssignForm({ load, onClose }: { load: { id: string; equipment_type: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const drivers = useList<Driver>("/drivers?status=active");
  const trucks = useList<Vehicle>("/vehicles?status=active");
  const trailers = useList<Trailer>("/trailers?status=active");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [trailerId, setTrailerId] = useState("");
  // One key per open dialog: a double click or a retry after a dropped response can't assign twice.
  const [key] = useState(newKey);

  const assign = useMutation({
    mutationFn: () =>
      api.post<LoadDetail>(
        "/dispatch/assignments",
        { load_id: load.id, driver_id: driverId, vehicle_id: vehicleId, trailer_id: trailerId || null },
        { idempotencyKey: key },
      ),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        assign.mutate();
      }}
    >
      <p className="text-sm text-slate-600">
        This load needs <strong className="font-medium text-slate-900">{label(load.equipment_type).toLowerCase()}</strong> equipment.
      </p>
      <Field label="Driver">
        {(p) => (
          <Select {...p} required value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Select a driver…</option>
            {drivers.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.first_name} {d.last_name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Truck">
        {(p) => (
          <Select {...p} required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Select a truck…</option>
            {trucks.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.unit_number}
                {v.make ? ` · ${v.make} ${v.model ?? ""}` : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Trailer">
        {(p) => (
          <Select {...p} value={trailerId} onChange={(e) => setTrailerId(e.target.value)}>
            <option value="">No trailer</option>
            {trailers.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.unit_number} · {label(t.type)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <ErrorNote error={assign.error} />
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={assign.isPending}>
          {assign.isPending ? "Assigning…" : "Assign"}
        </Button>
      </div>
    </form>
  );
}

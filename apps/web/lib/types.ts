export type Me = {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  organization_id: string;
  organization_name: string;
  timezone: string;
  permissions: string[];
};

export type Customer = {
  id: string;
  name: string;
  billing_email: string | null;
  phone: string | null;
  address: string | null;
  payment_terms_days: number;
  status: string;
  notes: string | null;
};

export type Driver = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  cdl_number: string | null;
  cdl_state: string | null;
  cdl_expiry: string | null;
  medical_cert_expiry: string | null;
  status: string;
  user_id: string | null;
};

export type Vehicle = {
  id: string;
  unit_number: string;
  vin: string | null;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  insurance_expiry: string | null;
  registration_expiry: string | null;
  status: string;
};

export type Trailer = {
  id: string;
  unit_number: string;
  type: string;
  vin: string | null;
  plate: string | null;
  insurance_expiry: string | null;
  registration_expiry: string | null;
  status: string;
};

export type Stop = {
  id: string;
  seq: number;
  type: "pickup" | "delivery";
  name: string | null;
  address: string | null;
  city: string;
  state: string | null;
  postal_code: string | null;
  appt_start: string | null;
  appt_end: string | null;
  arrived_at: string | null;
  departed_at: string | null;
};

export type Assignment = {
  id: string;
  driver_id: string;
  driver_name: string;
  vehicle_id: string;
  vehicle_unit: string;
  trailer_id: string | null;
  trailer_unit: string | null;
};

export type LoadSummary = {
  id: string;
  load_number: string;
  status: string;
  customer_id: string;
  customer_name: string | null;
  reference: string | null;
  commodity: string | null;
  equipment_type: string;
  customer_rate: string;
  currency: string;
  origin: string | null;
  destination: string | null;
  pickup_at: string | null;
  created_at: string;
};

export type LoadDetail = LoadSummary & {
  weight_lbs: number | null;
  notes: string | null;
  stops: Stop[];
  assignment: Assignment | null;
  events: { id: string; from_status: string | null; to_status: string; note: string | null; created_at: string }[];
  has_pod: boolean;
  invoice_id: string | null;
};

export type Doc = {
  id: string;
  type: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

export type Invoice = {
  id: string;
  invoice_number: string;
  load_id: string;
  load_number: string | null;
  customer_id: string;
  customer_name: string | null;
  status: string;
  issued_date: string;
  due_date: string;
  total: string;
  currency: string;
  paid_total: string;
  balance: string;
  overdue: boolean;
  lines: { description: string; quantity: string; unit_price: string; amount: string }[];
  payments: { id: string; amount: string; paid_on: string; method: string | null; reference: string | null }[];
};

export type Member = { user_id: string; email: string; full_name: string; role: string; active: boolean };

export type BoardCard = LoadSummary & { assignment: Assignment | null };

export type Board = { columns: Record<string, BoardCard[]>; truncated: boolean };

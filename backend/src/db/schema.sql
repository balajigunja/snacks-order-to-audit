-- RULES: money = INTEGER paisa, quantity = INTEGER in base unit (g, ml, pcs)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SALESMAN','ADMIN','PRODUCTION','ACCOUNTANT','OWNER'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gstin TEXT,
  state TEXT NOT NULL,              -- decides CGST+SGST or IGST
  salesman_id INTEGER REFERENCES users(id)
);

-- every stock thing: raw, packaging, finished good
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('RAW','PACKAGING','FG')),
  base_unit TEXT NOT NULL,          -- g, ml, pcs
  hsn_code TEXT,
  gst_rate_bp INTEGER DEFAULT 500,  -- 500 basis points = 5%
  price_paisa INTEGER,              -- selling price per packet (FG only)
  low_stock_qty INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS unit_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  factor INTEGER NOT NULL,          -- 1 kg = 1000 g
  item_id INTEGER REFERENCES items(id) -- NULL = global; carton->packets is per item
);

-- recipe
CREATE TABLE IF NOT EXISTS boms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fg_item_id INTEGER NOT NULL REFERENCES items(id),
  batch_output_qty INTEGER NOT NULL  -- 200 packets
);
CREATE TABLE IF NOT EXISTS bom_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_id INTEGER NOT NULL REFERENCES boms(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL               -- in base unit
);

-- THE GOLDEN TABLE: never UPDATE or DELETE rows here
CREATE TABLE IF NOT EXISTS stock_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL DEFAULT (datetime('now')),
  item_id INTEGER NOT NULL REFERENCES items(id),
  change_qty INTEGER NOT NULL,       -- + receipt, - issue
  balance_qty INTEGER NOT NULL,      -- running balance after this row
  value_paisa INTEGER NOT NULL DEFAULT 0, -- value of this movement (for costing)
  entry_type TEXT NOT NULL,          -- OPENING, PURCHASE, PRODUCTION_ISSUE, PRODUCTION_OUTPUT, DISPATCH, ADJUSTMENT, WASTAGE
  source_doc TEXT NOT NULL,          -- 'Purchase #1', 'Production Run #1', 'Invoice #1'
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  supplier TEXT,
  created_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS purchase_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL,              -- base unit
  total_paisa INTEGER NOT NULL       -- total cost of this line (rate is derived: total / qty)
);

CREATE TABLE IF NOT EXISTS production_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  bom_id INTEGER NOT NULL REFERENCES boms(id),
  expected_output INTEGER NOT NULL,
  good_packets INTEGER,
  damaged_pouches INTEGER DEFAULT 0,
  labour_paisa INTEGER DEFAULT 0,
  power_gas_paisa INTEGER DEFAULT 0,
  material_cost_paisa INTEGER,
  cost_per_packet_paisa INTEGER,
  yield_variance_pct_x100 INTEGER,   -- -6% stored as -600
  status TEXT DEFAULT 'STARTED',     -- STARTED, COMPLETED
  created_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS production_consumption (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES production_runs(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  standard_qty INTEGER NOT NULL,     -- from BOM
  actual_qty INTEGER NOT NULL,       -- what supervisor used
  variance_pct_x100 INTEGER,         -- +5% stored as 500
  flagged INTEGER DEFAULT 0          -- 1 if beyond tolerance
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  salesman_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'SUBMITTED', -- SUBMITTED, APPROVED, INVOICED, DISPATCHED, CANCELLED
  created_at TEXT DEFAULT (datetime('now')),
  client_uuid TEXT UNIQUE            -- for offline sync (avoids duplicates)
);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL,
  price_paisa INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,   -- e.g. INV/2026-27/0001
  order_id INTEGER NOT NULL REFERENCES orders(id),
  date TEXT NOT NULL,
  taxable_paisa INTEGER NOT NULL,
  cgst_paisa INTEGER NOT NULL DEFAULT 0,
  sgst_paisa INTEGER NOT NULL DEFAULT 0,
  igst_paisa INTEGER NOT NULL DEFAULT 0,
  total_paisa INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'POSTED', -- POSTED, CANCELLED (never deleted)
  dispatched INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invoice_counters (
  fin_year TEXT PRIMARY KEY,         -- '2026-27'
  last_no INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  date TEXT NOT NULL,
  amount_paisa INTEGER NOT NULL,
  mode TEXT                           -- CASH, UPI, BANK
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  date TEXT NOT NULL,
  reason TEXT,
  amount_paisa INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT DEFAULT (datetime('now')),
  user_id INTEGER,
  action TEXT NOT NULL,               -- 'ORDER_EDITED', 'INVOICE_CANCELLED'...
  table_name TEXT,
  record_id INTEGER,
  old_value TEXT,
  new_value TEXT
);

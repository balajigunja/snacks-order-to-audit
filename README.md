# Order-to-Audit System (Snacks Factory)
**Centre for Digital Infrastructure, NIT Tiruchirappalli — Winter Internship 2026**

A single-entry **Order-to-Audit** prototype for a small-scale South Indian packaged snacks manufacturer. Every field order, raw material purchase, production batch, GST invoice, dispatch, and collection is recorded once at its source and flows automatically into an append-only stock ledger, weighted-average packet costing, and auditor-ready reports.

---

## 1. Tech Stack & Justification

| Layer | Choice | Why |
| :--- | :--- | :--- |
| **Backend** | Node.js + Express (ESM) | Lightweight, single-language stack across server and UI with fast JSON/REST handling. |
| **Database** | SQLite (`node:sqlite` built-in) | Zero-configuration single-file relational DB supporting ACID transactions, foreign keys, and SQL aggregations without external DB setup. |
| **Frontend** | React 18 + Vite | Fast mobile-first UI for field salesmen (with `localStorage` offline queue) and multi-pane desktop views for factory operations. |
| **Auth & RBAC** | JWT + `bcryptjs` | Stateless role-based access control enforced on every API route (`SALESMAN`, `ADMIN`, `PRODUCTION`, `ACCOUNTANT`, `OWNER`). |
| **Documents & Exports** | `pdfkit` + UTF-8 BOM CSV | Pure-JS GST tax invoice PDF generation (with Indian lakh/crore amount-in-words) and formula-safe Excel/CSV audit exports. |

---

## 2. Quick Start (Single-Command Runner)

### Prerequisites
- **Node.js v22.5+** (uses built-in `node:sqlite` and `node:test`; no native C++ compiler or external database needed).

### Run Locally in One Command
From the repository root (`D:\order-to-audit` or `./order-to-audit`):

```bash
npm run setup
npm start
```

- **`npm run setup`**: Installs backend & frontend dependencies, initializes `backend/factory.db` from `schema.sql`, and seeds the Section 5 Murukku benchmark dataset.
- **`npm start`**: Starts the Express API (`http://localhost:5000`) and Vite frontend (`http://localhost:5173`) together.
- **`npm test`**: Runs all 11 automated unit & integration test suites (including the full Section 5 benchmark test).
- **`npm run db:reset`**: Wipes `backend/factory.db`, recreates tables, and reloads fresh Section 5 seed data for a clean demo run.

### Demo Login Credentials (Password: `password123`)

| Role | Name | Email | Default Screen |
| :--- | :--- | :--- | :--- |
| **Salesman** | Salesman A | `salesman.a@snacks.test` | Mobile Order Entry, Order Status & Customer Sales |
| **Salesman** | Salesman B | `salesman.b@snacks.test` | Mobile Order Entry (Interstate / Shortage Demo) |
| **Factory Admin** | Factory Admin | `admin@snacks.test` | Order Verification, Stock Check, GST Billing, Dispatch & Payments |
| **Production** | Production Supervisor | `production@snacks.test` | Raw Material Purchases, BOM Production Runs & Overheads |
| **Accountant / Auditor** | Accountant | `accountant@snacks.test` | Read-only Monthly Reports, GSTR-1/3B & CSV Exports |
| **Owner** | Owner | `owner@snacks.test` | Executive KPIs, Variance Alerts, Packet Cost & Stock Summary |

---

## 3. Core Engineering Rules

1. **Integer-Paisa Arithmetic:** All monetary values are stored and computed as whole integer paisa (`₹50.00 = 5000`), eliminating floating-point rounding drift.
2. **Base-Unit Inventory Storage:** Quantities are stored as integers in smallest base units (`1 kg = 1000 g`, `1 L = 1000 ml`, `1 packet/pouch/carton = 1 pcs`).
3. **Append-Only Stock Ledger:** Stock balances are never overwritten. Every receipt, production issue, production output, dispatch, or credit-note adjustment appends an immutable row to `stock_ledger` linked to its `source_doc`.
4. **Audit Trail & Credit Notes:** Edits to orders, overheads, dispatches, and invoice cancellations are recorded with user ID and timestamp in `audit_log`. Posted invoices are never deleted—cancelling an invoice issues a `credit_notes` record and restores dispatched stock.

---

## 4. Costing Method & Overhead Allocation Rule

- **Inventory Valuation Method — Weighted Average Cost:**
  $$	ext{Average Unit Cost} = rac{	ext{Total Stock Value in Ledger (paisa)}}{	ext{Total Quantity on Hand (base units)}}$$
  *Justification:* Raw materials like flour and cooking oil are stored in bulk containers where batches mix physically, making weighted average more realistic than FIFO/LIFO for a small snack factory while smoothing purchase price fluctuations (`₹42/kg` opening flour + `₹45/kg` new purchase = `₹43.125/kg`).
- **Overhead Allocation Rule — Direct Per-Run Allocation over Good Output:**
  Direct batch overheads (labour + gas/power entered for the run) are added to actual raw + packaging material cost and divided by **good saleable packets produced** (`188` packets), ensuring abnormal yield loss (`-6%`) is surfaced transparently in unit cost and margin.

---

## 5. Section 5 Benchmark Results

Running `npm test` executes `backend/tests/benchmark.test.js` end-to-end with the exact Section 5 master data:

| Benchmark Checkpoint | Expected | System Output | Notes |
| :--- | :--- | :--- | :--- |
| **Flour closing balance** | `120 kg` | **`120 kg`** (`120000 g`) | `100 kg` opening + `60 kg` purchase − `40 kg` issued |
| **Cooking oil closing balance** | `19.5 L` | **`19.5 L`** (`19500 ml`) | `30 L` opening − `10.5 L` issued |
| **Pouches closing balance** | `306 pcs` | **`306 pcs`** | `500` opening − (`188` good + `6` damaged) |
| **Cartons closing balance** | `21 pcs` | **`21 pcs`** | `30` opening − `9` used (`-10%` variance vs 10 standard) |
| **Finished goods after run** | `238 packets` | **`238 packets`** | `50` opening + `188` good packets |
| **Yield variance** | `-6%`, flagged | **`-6.00%` (Flagged)** | `188` actual vs `200` expected (`> 3%` tolerance) |
| **Oil consumption variance** | `+5%`, flagged | **`+5.00%` (Flagged)** | `10.5 L` actual vs `10.0 L` standard (`> 3%` tolerance) |
| **Retailer A invoice (TN)** | `₹7,500 + ₹187.50 CGST + ₹187.50 SGST = ₹7,875` | **`₹7,875.00`** (`INV/2026-27/0001`) | Intra-state 5% GST split equally (`2.5%` CGST + `2.5%` SGST) |
| **Finished goods after dispatch** | `88 packets` | **`88 packets`** | `238` − `150` dispatched to Retailer A |
| **Retailer A outstanding** | `₹3,875` | **`₹3,875.00`** | `₹7,875.00` invoice − `₹4,000.00` UPI payment |
| **Distributor B order (KA, 120 pkts)** | `32` short flagged; IGST if invoiced | **`32` short (HTTP 409); `5%` IGST** | Blocks approval until trimmed to `88` pkts (`₹4,400 + ₹220 IGST = ₹4,620`) |
| **Cost per packet & margin** | Cost + rule stated | **`₹31.14 / packet` (`37.72%` margin)** | Materials `₹4,055.00` + Labour `₹1,200.00` + Gas/Power `₹600.00` = `₹5,855.00 / 188` |

---

## 6. Feature Coverage vs. Section 6 Scope

### Must Have
- [x] Role-based login (`SALESMAN`, `ADMIN`, `PRODUCTION`, `ACCOUNTANT`, `OWNER`)
- [x] Product, customer, raw-material, packaging, and BOM masters
- [x] Mobile-friendly salesman order entry and desktop admin verification/approval with live stock check
- [x] GST tax invoice PDF download & customer share links (WhatsApp / email / public token link)
- [x] Production runs updating raw, packaging, and finished-goods ledger stock automatically
- [x] Planned vs. actual consumption and yield variance tracking (`3%` configurable tolerance)
- [x] Immutable stock summary and source-linked stock ledger
- [x] Sales register, GST reports, and stock reports exportable to Excel-compatible CSV

### Should Have
- [x] Raw material & packaging purchases with supplier tracking
- [x] Partial/full payment recording, customer outstanding balances, and `0–30 / 31–60 / 61–90 / 90+` day ageing
- [x] Cost per packet with direct run overheads and selling margin
- [x] GSTR-1 (invoice-wise & HSN summary) and GSTR-3B outward supply reports
- [x] Automatic variance alerts beyond tolerance
- [x] Executive Owner dashboard

### Stretch Goals Implemented
- [x] **Offline order capture with automatic sync:** Orders created while offline queue in `localStorage` with a unique `client_uuid` and auto-sync when connectivity returns without duplicates.

---

## 7. Documented Assumptions & Known Gaps

1. **Opening Finished-Goods Valuation:** The 50 opening packets of `Murukku 200 g` in Section 5 do not specify an opening unit cost and are seeded with `0` ledger value; run cost per packet (`₹31.14`) is computed strictly from Run #1's actual material consumption (`₹4,055.00`) plus Run #1's overheads (`₹1,800.00`) divided by `188` good packets.
2. **Audit Report Export Formats:** Tax invoices export directly as formatted PDFs (`/api/invoices/:id/pdf`), whereas all 12 monthly audit reports export as UTF-8 BOM CSV files (`/api/reports/:name?format=csv`) designed to open cleanly in Microsoft Excel without formula injection.
3. **Single-Batch Dispatch & Batch Expiry:** Each invoice dispatches in full (`POST /api/dispatch`), and batch/expiry FEFO tracking is omitted in favor of keeping the core ledger deterministic and auditable.

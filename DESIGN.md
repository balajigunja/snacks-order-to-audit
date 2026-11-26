# Design Note: Order-to-Audit System (Snacks Factory)
**Centre for Digital Infrastructure, NIT Tiruchirappalli — Winter Internship 2026**

---

## 1. System Overview & Architecture

The system links two operational loops around a single immutable **`stock_ledger`** inside SQLite (`node:sqlite`):
1. **Sales Loop:** `Salesman Order (Mobile/Offline) -> Admin Stock Check & Approval -> GST Invoice -> Dispatch (FG Stock Down) -> Payment Collection`
2. **Production Loop:** `Raw/Packaging Purchase (Stock Up) -> BOM Issue (Raw Stock Down) -> Run Completion (Packaging Down, FG Stock Up, Variance Flagged) -> Overhead Costing`

All financial values are stored as **integer paisa** (`₹1 = 100 paisa`) and all physical quantities as **integer base units** (`g`, `ml`, `pcs`) to eliminate floating-point rounding drift.

### Entity-Relationship Diagram

```text
+-------------+       +---------------+       +------------------+
|    users    |1-----*|   customers   |1-----*|      orders      |
| (5 roles)   |       | (state,gstin) |       | (client_uuid)    |
+-------------+       +---------------+       +------------------+
       |                                               | 1
       | created_by                                    | *
       v                                      +------------------+
+------------------+   source_doc             |   order_lines    |
|   stock_ledger   |<-----------------+       +------------------+
| (append-only:    |                  |                | 1:1 (when approved)
|  change_qty,     |                  |                v
|  balance_qty,    |   +--------------+       +------------------+       +--------------+
|  value_paisa)    |   |              |       |     invoices     |1-----*|   payments   |
+------------------+   |              |       | (FY seq, CGST/   |       +--------------+
       ^               |              |       |  SGST/IGST)      |1-----*| credit_notes |
       | *             |              |       +------------------+       +--------------+
+------------------+   |              |                | 1
|      items       |   |              |                | *
| (RAW, PACKAGING, |<--+              |       +------------------+
|  FG, base_unit)  |                  |       |  invoice_lines   |
+------------------+                  |       +------------------+
       | 1                            |
       | *                            |
+------------------+   +--------------+       +------------------------+
|    bom_lines     |   |                      | production_consumption |
| (std qty/batch)  |   |                      | (std vs actual, var %) |
+------------------+   |                      +------------------------+
       ^               |                                   ^
       | *             |                                   | *
+------------------+   |                      +------------------------+
|       boms       |1--+--------------------->|    production_runs     |
| (batch_output)   |                          | (yield var, overheads, |
+------------------+                          |  cost_per_packet_paisa)|
                                              +------------------------+
```

---

## 2. Stock Ledger & BOM Consumption Math

### Append-Only Ledger Reconciliation
Direct `UPDATE` or `DELETE` operations on stock quantities are prohibited. Every physical movement inserts a row into `stock_ledger`:
$$	ext{Balance}_{t} = 	ext{Balance}_{t-1} + \Delta q_t, \quad 	ext{enforcing } 	ext{Balance}_{t} \ge 0$$

For any reporting period $[t_1, t_2]$, the Stock Summary report reconciles every SKU strictly from ledger entries:
$$	ext{Closing} = 	ext{Opening}_{< t_1} + \sum 	ext{Receipts}_{[t_1, t_2]} - \sum 	ext{Issues}_{[t_1, t_2]} + \sum 	ext{Adjustments}_{[t_1, t_2]}$$

### Unit Conversions & BOM Scaling
Inputs in human units (`kg`, `litre`, `pcs`) are validated against the item's `base_unit` (`g`, `ml`, `pcs`) and converted via integer multipliers (`×1000` for `kg -> g` and `litre -> ml`). For a production run of $B$ batches:
$$	ext{Standard Qty}_i = 	ext{BOM Qty}_i 	imes B, \quad 	ext{Expected Yield} = 	ext{Batch Output} 	imes B$$

### Variance & Tolerance Flagging
Material consumption variance and output yield variance are stored as integer basis points of percent (`pct_x100`, where `-600` = `-6.00%`):
$$	ext{Variance}_{\% 	imes 100} = 	ext{round}\left(rac{	ext{Actual} - 	ext{Standard}}{	ext{Standard}} 	imes 10000ight)$$
Any material or yield line where $|	ext{Variance}_{\% 	imes 100}| > 300$ (`3.00%` configurable threshold) sets `flagged = 1` and surfaces on the Production and Owner dashboards.

---

## 3. Costing & Valuation Method

1. **Weighted-Average Material Valuation:**
   Each receipt adds positive `value_paisa` to `stock_ledger`; each issue deducts value at the current average rate immediately before posting:
   $$	ext{Issue Value (paisa)} = 	ext{round}\left(rac{\sum 	ext{Value on Hand (paisa)} 	imes 	ext{Issued Qty}}{	ext{Qty on Hand}}ight)$$
   *Benchmark trace:* Opening flour (`100 kg @ ₹42 = ₹4,200`) + Purchase #1 (`60 kg @ ₹45 = ₹2,700`) = `₹6,900` across `160 kg` (`₹43.125/kg`). Issuing `40 kg` charges **`₹1,725.00`** (`172500` paisa) to Run #1.
2. **Batch Material Total (Run #1):**
   Flour (`₹1,725.00`) + Cooking oil (`10.5 L @ ₹140 = ₹1,470.00`) + Spice mix (`1.2 kg @ ₹200 = ₹240.00`) + Pouches (`194 × ₹2.50 = ₹485.00`) + Cartons (`9 × ₹15 = ₹135.00`) = **`₹4,055.00`**.
3. **Overhead Allocation & Packet Margin:**
   Direct run overheads (`₹1,200.00` labour + `₹600.00` gas/power = `₹1,800.00`) are allocated per batch and divided by **good packets produced** (`188`):
   $$	ext{Cost per Packet} = 	ext{round}\left(rac{405500 + 180000}{188}ight) = 3114	ext{ paisa} = \mathbf{₹31.14}$$
   Against the `₹50.00` (`5000` paisa) pre-tax selling price, gross profit is **`₹18.86/packet`** (**`37.72%`** margin).

---

## 4. GST Compliance, Auditability & Offline Sync

- **GST Place-of-Supply Engine:** Compares `customer.state` against `FACTORY_STATE` (`Tamil Nadu`). Intra-state invoices split `gst_rate_bp` (`500` bp = `5%`) equally into `CGST` (`2.5%`) and `SGST` (`2.5%`); inter-state invoices assign `100%` of tax to `IGST`. Invoice numbers increment atomically per April–March financial year (`INV/2026-27/0001`) inside the creation transaction so sequence numbers never skip on rollback.
- **Immutability & Audit Trail:** Every order edit, approval, invoice creation, dispatch, payment, overhead update, and invoice cancellation writes before/after JSON snapshots to `audit_log`. Cancelling a posted invoice creates a `credit_notes` entry and reverses dispatched stock via an `ADJUSTMENT` ledger row rather than deleting records.
- **Offline Field Order Sync:** The mobile salesman view caches masters in `localStorage`, queues offline orders with a client-generated `client_uuid` (`UNIQUE` constraint in `orders`), and auto-flushes on the browser `online` event with idempotent duplicate protection.

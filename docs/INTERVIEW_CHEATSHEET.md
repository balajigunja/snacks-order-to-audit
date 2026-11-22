# Interview cheat sheet (30-min live modification)

## Likely live changes and where to edit
| Ask | Where |
|-----|-------|
| Add 500g pack size sharing same BOM | items + products tables, bom link (BOM per product family, scale by qty) |
| Change GST 5% -> 12% | gst_rate_bp in products; utils/gst.js is rate-driven |
| Change variance tolerance 3% -> 5% | .env VARIANCE_TOLERANCE_PCT, services/variance.js |
| Switch costing to FIFO / Last price | services/costing.js only |
| Add new unit (dozen) | utils/units.js conversion table |
| Add new report | routes/reports.js + one SQL query |

## Why weighted average? (write your own reasoning)
- Flour Rs42 + Rs45 purchases blend into one fair average cost
- Easy to explain and no batch tracking needed

## Questions to be ready for
- Why integer paisa?  -> floats give 0.1+0.2 != 0.3 errors
- Why ledger and not one quantity column? -> audit trail, can rebuild balance, no silent edits
- CGST/SGST vs IGST? -> same state vs different state
- Why credit note not delete? -> GST law, audit trail
- What is a DB transaction? -> invoice + ledger writes succeed together or not at all

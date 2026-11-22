# Build order (do ONE step, test it, git commit)

Must Have first. Stretch goals only at the end.

- [ ] Day 1  Setup: npm install, db init, login for 3 roles (Salesman, Admin, Production) -> commit "auth + roles"
- [ ] Day 2  utils: money.js, units.js, gst.js + unit tests -> commit "money, unit, gst helpers"
- [ ] Day 3  Masters: items, customers, price list, BOM + seed script -> commit "masters + seed"
- [ ] Day 4  Stock ledger service (addEntry, getBalance) -> commit "stock ledger"
- [ ] Day 5  Purchases (raw stock UP) -> commit
- [ ] Day 6  Production run: issue raw (DOWN), output FG (UP), variance + alert -> commit
- [ ] Day 7  Costing: weighted average + overheads -> cost per packet -> commit
- [ ] Day 8  Salesman order screen (mobile) + status -> commit
- [ ] Day 9  Admin: stock check warning, approve, invoice (CGST/SGST/IGST), invoice no. by FY -> commit
- [ ] Day 10 PDF invoice + WhatsApp share link -> commit
- [ ] Day 11 Dispatch (FG DOWN) + Payments (outstanding) -> commit
- [ ] Day 12 Credit note + audit_log -> commit
- [ ] Day 13 Reports + CSV/PDF export + ageing -> commit
- [ ] Day 14 Benchmark test passes all 9 steps, README polish
- [ ] Stretch (pick 1-2): offline order sync (localStorage), low-stock alert, Owner dashboard

Commit after every checkbox. Never one big "final upload" commit.

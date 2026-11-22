# Order-to-Audit System (Snacks Factory)
NIT Tiruchirappalli - Winter Internship 2026

## Tech stack (and WHY - say this in the interview)
| Part | Choice | Why |
|------|--------|-----|
| Backend | Node.js + Express (plain JavaScript) | Simple, one language everywhere |
| Database | SQLite (better-sqlite3) | Zero install, one file, SQL is great for ledgers & reports, supports transactions |
| Frontend | React + Vite | Fast to set up, mobile-friendly |
| Auth | JWT + bcrypt, role stored in token | Easy RBAC with a middleware |
| PDF | pdfkit (invoice + reports) | Pure JS, no browser needed |
| Excel/CSV | exceljs / plain CSV string | Simple |

## Rules I follow
1. Money = integer paisa. Never float. (Rs 50 = 5000)
2. Quantities = integer in smallest unit (kg stored as grams, L as ml). 40 kg = 40000 g.
3. Stock is never overwritten: every movement is a row in `stock_ledger`.
4. Posted invoices are never deleted: cancel with a credit note. Every change goes to `audit_log`.
5. Costing method: Weighted Average  (explain choice here - see docs/INTERVIEW_CHEATSHEET.md)

## Run
```
cd backend && npm install && npm run db:init && npm run seed && npm run dev
cd frontend && npm install && npm run dev
```

## Folder map
- backend/src/db/schema.sql      -> all tables
- backend/src/db/seed_benchmark.js -> Section 5 Murukku data
- backend/src/utils/             -> money, units, gst (small pure functions)
- backend/src/services/          -> business logic (ledger, costing, variance, invoice no.)
- backend/src/routes/            -> HTTP endpoints per role
- frontend/src/pages/            -> one screen per role

See docs/BUILD_ORDER.md for the step-by-step plan.

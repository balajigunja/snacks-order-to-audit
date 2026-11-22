
import bcrypt from 'bcryptjs';
import db, { runInTransaction } from './connection.js';
import { addEntry } from '../services/stockLedger.js';
import { toBase } from '../utils/units.js';
import { rupeesToPaisa } from '../utils/money.js';

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('Database already has data. Delete factory.db, run npm run db:init, then seed again.');
  process.exit(0);
}

const PASSWORD = 'password123'; // demo logins for every role 
const hash = bcrypt.hashSync(PASSWORD, 10);

runInTransaction(() => {
  // ---------- 1. USERS (one per role + two salesmen) ----------
  const addUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
  const salesmanA = Number(addUser.run('Salesman A', 'salesman.a@snacks.test', hash, 'SALESMAN').lastInsertRowid);
  const salesmanB = Number(addUser.run('Salesman B', 'salesman.b@snacks.test', hash, 'SALESMAN').lastInsertRowid);
  addUser.run('Factory Admin', 'admin@snacks.test', hash, 'ADMIN');
  addUser.run('Production Supervisor', 'production@snacks.test', hash, 'PRODUCTION');
  addUser.run('Accountant', 'accountant@snacks.test', hash, 'ACCOUNTANT');
  addUser.run('Owner', 'owner@snacks.test', hash, 'OWNER');

  // ---------- 2. CUSTOMERS ----------
  const addCustomer = db.prepare('INSERT INTO customers (name, gstin, state, salesman_id) VALUES (?, ?, ?, ?)');
  addCustomer.run('Retailer A', '33AAAAA1111A1Z1', 'Tamil Nadu', salesmanA);
  addCustomer.run('Distributor B', '29BBBBB2222B1Z2', 'Karnataka', salesmanB);

  // ---------- 3. ITEMS ----------
  const addItem = db.prepare(
    'INSERT INTO items (name, category, base_unit, hsn_code, gst_rate_bp, price_paisa) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const id = (r) => Number(r.lastInsertRowid);
  const flour  = id(addItem.run('Flour',              'RAW',       'g',   '1101', 0, null));
  const oil    = id(addItem.run('Cooking oil',        'RAW',       'ml',  '1512', 0, null));
  const spice  = id(addItem.run('Salt and spice mix', 'RAW',       'g',   '0910', 0, null));
  const pouch  = id(addItem.run('200 g pouch',        'PACKAGING', 'pcs', '3923', 0, null));
  const carton = id(addItem.run('Carton (20 packets)', 'PACKAGING', 'pcs', '4819', 0, null));
  const murukku = id(addItem.run('Murukku 200 g', 'FG', 'pcs', '21069099', 500, rupeesToPaisa(50)));

  // ---------- 4. UNIT CONVERSIONS ----------
  const addConv = db.prepare('INSERT INTO unit_conversions (from_unit, to_unit, factor, item_id) VALUES (?, ?, ?, ?)');
  addConv.run('kg', 'g', 1000, null);
  addConv.run('litre', 'ml', 1000, null);
  addConv.run('carton', 'packet', 20, murukku);

  // ---------- 5. BOM: Murukku 200 g, one batch = 200 packets ----------
  const bomId = id(db.prepare('INSERT INTO boms (fg_item_id, batch_output_qty) VALUES (?, ?)').run(murukku, 200));
  const addLine = db.prepare('INSERT INTO bom_lines (bom_id, item_id, qty) VALUES (?, ?, ?)');
  addLine.run(bomId, flour,  toBase(40,  'kg'));    // 40000 g
  addLine.run(bomId, oil,    toBase(10,  'litre')); // 10000 ml
  addLine.run(bomId, spice,  toBase(1.2, 'kg'));    // 1200 g
  addLine.run(bomId, pouch,  200);
  addLine.run(bomId, carton, 10);

  // ---------- 6. OPENING STOCK (as OPENING ledger rows) ----------
  // valuePaisa = TOTAL value of the quantity. I have store totals, not per-gram rates,
  // because Rs 42/kg = 4.2 paisa per gram is not a whole number.
  const opening = (itemId, qty, valuePaisa) =>
    addEntry({ itemId, changeQty: qty, valuePaisa, entryType: 'OPENING', sourceDoc: 'Opening balance' });

  opening(flour,   toBase(100, 'kg'),   100 * rupeesToPaisa(42));  // Rs 4,200
  opening(oil,     toBase(30, 'litre'),  30 * rupeesToPaisa(140)); // Rs 4,200
  opening(spice,   toBase(5, 'kg'),       5 * rupeesToPaisa(200)); // Rs 1,000
  opening(pouch,   500,                 500 * rupeesToPaisa(2.5)); // Rs 1,250
  opening(carton,  30,                   30 * rupeesToPaisa(15));  // Rs 450
 
  opening(murukku, 50, 0);
});

console.log('Seed complete. Demo password for all users:', PASSWORD);

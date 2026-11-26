// Builds the tax invoice PDF. Returns a Buffer (the whole file in memory).
// NOTE: the standard PDF fonts have no rupee sign, so amounts are written as "Rs."
import PDFDocument from 'pdfkit';
import db from '../db/connection.js';

const money = (paisa) => 'Rs. ' + (paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 787500 paisa -> "Rupees Seven Thousand Eight Hundred Seventy Five Only" (Indian lakh / crore style)
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n) {
  const out = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], 'Hundred'); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); n %= 10; }
  if (n > 0) out.push(ONES[n]);
  return out.join(' ');
}

export function amountInWords(paisa) {
  let rupees = Math.floor(paisa / 100);
  const paise = paisa % 100;
  const parts = [];
  for (const [size, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) {
    if (rupees >= size) { parts.push(below1000(Math.floor(rupees / size)), name); rupees %= size; }
  }
  if (rupees > 0) parts.push(below1000(rupees));
  const rupeeWords = parts.length ? parts.join(' ') : 'Zero';
  return `Rupees ${rupeeWords}${paise ? ' and ' + below1000(paise) + ' Paise' : ''} Only`;
}

export function invoiceFileName(invoiceNo) {
  return invoiceNo.replace(/\//g, '-') + '.pdf'; // INV/2026-27/0001 -> INV-2026-27-0001.pdf
}

export function buildInvoicePdf(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(invoiceId));
  if (!inv) throw new Error('Invoice not found');
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(inv.id);

  const factory = {
    name: process.env.FACTORY_NAME || 'Snack Factory',
    address: process.env.FACTORY_ADDRESS || 'Tiruchirappalli, Tamil Nadu',
    gstin: process.env.FACTORY_GSTIN || '33AAAAA0000A1Z5',
    state: process.env.FACTORY_STATE || 'Tamil Nadu'
  };

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'Tax invoice ' + inv.invoice_no } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const width = 515;
    const right = left + width;

    // ----- header -----
    doc.font('Helvetica-Bold').fontSize(18).text(factory.name, left, 40);
    doc.font('Helvetica').fontSize(9).fillColor('#444')
      .text(factory.address, left, 62).text(`GSTIN: ${factory.gstin}   State: ${factory.state}`, left, 75);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', left, 40, { width, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#444').text('Original for recipient', left, 62, { width, align: 'right' });
    if (inv.status === 'CANCELLED') {
      doc.fillColor('#d93025').font('Helvetica-Bold').fontSize(12).text('CANCELLED', left, 75, { width, align: 'right' });
    }
    doc.fillColor('#000');
    doc.moveTo(left, 95).lineTo(right, 95).strokeColor('#999').stroke();

    // ----- invoice and customer details -----
    doc.font('Helvetica-Bold').fontSize(10).text('Invoice details', left, 105);
    doc.font('Helvetica').fontSize(10)
      .text(`Invoice no: ${inv.invoice_no}`, left, 120)
      .text(`Date: ${inv.date}`, left, 134)
      .text(`Place of supply: ${inv.place_of_supply}`, left, 148);
    doc.font('Helvetica-Bold').text('Bill to', 320, 105);
    doc.font('Helvetica')
      .text(inv.customer_name, 320, 120, { width: 235 })
      .text(`GSTIN: ${inv.customer_gstin || 'Not registered'}`, 320, 134)
      .text(`State: ${inv.place_of_supply}`, 320, 148);

    // ----- item table -----
    const cols = [
      ['#', 25, 'left'], ['Description', 135, 'left'], ['HSN', 65, 'left'], ['Qty', 40, 'right'],
      ['Rate', 60, 'right'], ['Taxable value', 80, 'right'], ['GST %', 40, 'right'], ['GST amount', 70, 'right']
    ];
    let y = 175;
    const rowHeight = 20;
    const drawRow = (cells, bold, fill) => {
      if (fill) doc.rect(left, y, width, rowHeight).fill('#f1f3f4');
      doc.fillColor('#000').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      let x = left;
      cols.forEach(([, w, align], i) => {
        doc.text(String(cells[i]), x + 4, y + 6, { width: w - 8, align, lineBreak: false });
        x += w;
      });
      doc.moveTo(left, y + rowHeight).lineTo(right, y + rowHeight).strokeColor('#ccc').stroke();
      y += rowHeight;
    };
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#999').stroke();
    drawRow(cols.map((c) => c[0]), true, true);
    lines.forEach((l, i) => {
      const tax = l.cgst_paisa + l.sgst_paisa + l.igst_paisa;
      drawRow([i + 1, l.item_name, l.hsn_code || '', l.qty, money(l.price_paisa), money(l.taxable_paisa), (l.gst_rate_bp / 100) + '%', money(tax)], false, false);
    });

    // ----- totals -----
    y += 12;
    const rates = [...new Set(lines.map((l) => l.gst_rate_bp))];
    const half = rates.length === 1 ? ` @ ${rates[0] / 200}%` : '';
    const totals = [['Taxable value', inv.taxable_paisa]];
    if (inv.cgst_paisa > 0) totals.push([`CGST${half}`, inv.cgst_paisa]);
    if (inv.sgst_paisa > 0) totals.push([`SGST${half}`, inv.sgst_paisa]);
    if (inv.igst_paisa > 0) totals.push([`IGST${rates.length === 1 ? ' @ ' + rates[0] / 100 + '%' : ''}`, inv.igst_paisa]);
    doc.font('Helvetica').fontSize(10);
    for (const [label, value] of totals) {
      doc.text(label, 330, y, { width: 120 }).text(money(value), 450, y, { width: 105, align: 'right' });
      y += 16;
    }
    doc.moveTo(330, y + 2).lineTo(right, y + 2).strokeColor('#999').stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(12)
      .text('Invoice total', 330, y, { width: 120 }).text(money(inv.total_paisa), 450, y, { width: 105, align: 'right' });
    y += 28;
    doc.font('Helvetica').fontSize(10).text('Amount in words:', left, y);
    doc.font('Helvetica-Bold').text(amountInWords(inv.total_paisa), left, y + 14, { width });

    // ----- footer -----
    y += 60;
    doc.font('Helvetica').fontSize(9).fillColor('#444')
      .text('Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', left, y, { width: 330 });
    doc.fillColor('#000').fontSize(10).text(`For ${factory.name}`, 380, y, { width: 175, align: 'right' });
    doc.fontSize(9).text('Authorised signatory', 380, y + 50, { width: 175, align: 'right' });
    doc.fillColor('#888').fontSize(8).text('This is a computer generated invoice.', left, 790, { width, align: 'center' });
    doc.end();
  });
}

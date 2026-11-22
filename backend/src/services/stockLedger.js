// THE most important file. Rule: only INSERT, never UPDATE/DELETE.
// TODO addEntry({ itemId, changeQty, valuePaisa, entryType, sourceDoc, userId })
//   1. read last balance of the item  2. newBalance = last + changeQty
//   3. block if newBalance < 0 (for issues)  4. INSERT row
// TODO getBalance(itemId)
// TODO getLedger(itemId, fromDate, toDate)

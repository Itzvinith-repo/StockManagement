import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

import { db, deleteTransaction } from '../src/db.js';

test('deleteTransaction removes a stock-in entry and reverses the item quantity', async () => {
  await db.transaction('rw', db.items, db.transactions, async () => {
    await db.items.clear();
    await db.transactions.clear();

    await db.items.put({
      id: 1,
      name: 'Sample Dress',
      description: '',
      supplierName: 'Supplier A',
      supplierContact: '',
      quantity: 10,
      unitPrice: 100,
      totalValue: 1000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.transactions.put({
      id: 1,
      type: 'IN',
      timestamp: new Date().toISOString(),
      itemId: 1,
      itemName: 'Sample Dress',
      supplierName: 'Supplier A',
      customerName: '',
      referenceNo: 'INV-001',
      quantity: 3,
      unitPrice: 100,
      totalAmount: 300,
      reasonCode: 'Stock Receiving',
      notes: 'Wrong entry',
      description: '',
    });
  });

  const removed = await deleteTransaction(1);

  assert.equal(removed.type, 'IN');
  assert.equal(removed.quantity, 3);

  const item = await db.items.get(1);
  assert.equal(item.quantity, 7);
  assert.equal(item.totalValue, 700);

  const tx = await db.transactions.get(1);
  assert.equal(tx, undefined);
});

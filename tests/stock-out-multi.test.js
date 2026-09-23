import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

import { db, processStockOutMulti } from '../src/db.js';

async function seedItems() {
  await db.transaction('rw', db.items, db.transactions, async () => {
    await db.items.clear();
    await db.transactions.clear();

    await db.items.put({
      id: 1,
      name: 'Floral Dress',
      description: '',
      supplierName: 'Supplier A',
      supplierContact: '',
      quantity: 10,
      unitPrice: 500,
      totalValue: 5000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.items.put({
      id: 2,
      name: 'Silk Maxi',
      description: '',
      supplierName: 'Supplier B',
      supplierContact: '',
      quantity: 20,
      unitPrice: 800,
      totalValue: 16000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
}

test('processStockOutMulti deducts stock and stores sales/cost amounts for profit', async () => {
  await seedItems();

  await processStockOutMulti([
    { itemId: 1, quantity: 2, unitPrice: 750, timestamp: '2026-09-20T10:00:00.000Z', customerName: 'Retailer A', supplierName: 'Supplier A', referenceNo: 'INV-101', reasonCode: 'Wholesale Customer Sale', notes: '' },
    { itemId: 2, quantity: 5, unitPrice: 1200, timestamp: '2026-09-20T10:00:00.000Z', customerName: 'Retailer A', supplierName: 'Supplier B', referenceNo: 'INV-101', reasonCode: 'Wholesale Customer Sale', notes: '' },
  ]);

  const item1 = await db.items.get(1);
  const item2 = await db.items.get(2);

  assert.equal(item1.quantity, 8);
  assert.equal(item2.quantity, 15);
  assert.equal(item1.totalValue, 8 * 500);
  assert.equal(item2.totalValue, 15 * 800);

  const txs = await db.transactions.toArray();
  assert.equal(txs.length, 2);

  const out1 = txs.find(tx => tx.itemId === 1);
  assert.equal(out1.type, 'OUT');
  assert.equal(out1.quantity, 2);
  assert.equal(out1.unitPrice, 750);
  assert.equal(out1.totalAmount, 1500);
  assert.equal(out1.totalWholesaleAmount, 1500);
  assert.equal(out1.totalCostAmount, 1000);
  assert.equal(out1.wholesalePrice, 750);

  const out2 = txs.find(tx => tx.itemId === 2);
  assert.equal(out2.totalWholesaleAmount, 6000);
  assert.equal(out2.totalCostAmount, 4000);
});

test('processStockOutMulti rolls back the whole transaction when one item exceeds stock', async () => {
  await seedItems();

  await assert.rejects(
    processStockOutMulti([
      { itemId: 1, quantity: 1, unitPrice: 750, timestamp: '2026-09-20T10:00:00.000Z', customerName: 'Retailer A', supplierName: 'Supplier A', reasonCode: 'Wholesale Customer Sale', notes: '' },
      { itemId: 2, quantity: 99, unitPrice: 1200, timestamp: '2026-09-20T10:00:00.000Z', customerName: 'Retailer A', supplierName: 'Supplier B', reasonCode: 'Wholesale Customer Sale', notes: '' },
    ]),
    /Insufficient stock/
  );

  const item1 = await db.items.get(1);
  const item2 = await db.items.get(2);
  assert.equal(item1.quantity, 10, 'first item must not be deducted after rollback');
  assert.equal(item2.quantity, 20, 'second item must not be deducted after rollback');

  const txCount = await db.transactions.count();
  assert.equal(txCount, 0, 'no transactions should be recorded after rollback');
});

test('processStockOutMulti rejects invalid / empty payloads', async () => {
  await seedItems();

  await assert.rejects(processStockOutMulti([]), /No stock-out items/);
  await assert.rejects(
    processStockOutMulti([{ itemId: 1, quantity: 0, unitPrice: 750, timestamp: '2026-09-20T10:00:00.000Z', reasonCode: 'Wholesale Customer Sale', notes: '' }]),
    /greater than zero/
  );
});
import test from 'node:test';
import assert from 'node:assert/strict';

import { computeProfitSummary } from '../src/profitAnalyzer.js';

const itemA = { id: 1, name: 'Product A', quantity: 100, unitPrice: 500 };
const itemB = { id: 2, name: 'Product B', quantity: 50, unitPrice: 300 };

test('calculates daily profit as the Stock-Out amount', () => {
  const transactions = [
    { id: 1, type: 'IN', timestamp: '2026-09-20T10:00:00.000Z', itemId: 1, quantity: 100, unitPrice: 500, totalAmount: 50000, totalCostAmount: 50000 },
    { id: 2, type: 'OUT', timestamp: '2026-09-20T11:00:00.000Z', itemId: 1, quantity: 10, unitPrice: 750, totalAmount: 7500, totalWholesaleAmount: 7500, totalCostAmount: 5000 },
  ];

  const result = computeProfitSummary({
    transactions,
    items: [itemA, itemB],
    fromDate: '2026-09-20',
    toDate: '2026-09-20',
  });

  const day = result.rows.find(row => row.date === '2026-09-20');
  assert.equal(day.stockInCost, 50000);
  assert.equal(day.stockOutSales, 7500);
  assert.equal(day.stockOutCost, 5000);
  assert.equal(day.profit, 7500, 'profit = Stock-Out amount (750x10), no cost subtraction');
  assert.equal(day.stockInCount, 1);
  assert.equal(day.stockOutCount, 1);
});

test('uses stored totalWholesaleAmount as profit and falls back to stored unitPrice', () => {
  const transactions = [
    // Legacy OUT record has no stored cost fields
    { id: 1, type: 'OUT', timestamp: '2026-09-21T10:00:00.000Z', itemId: 2, quantity: 8, unitPrice: 450, totalAmount: 3600 },
  ];

  const result = computeProfitSummary({
    transactions,
    items: [itemA, itemB],
    fromDate: '2026-09-21',
    toDate: '2026-09-21',
  });

  const day = result.rows.find(row => row.date === '2026-09-21');
  assert.equal(day.stockOutSales, 3600);
  assert.equal(day.stockOutCost, 8 * 300, 'cost uses itemB purchase price (300)');
  assert.equal(day.profit, 3600, 'profit = Stock-Out amount');
});

test('computes totals across a date range without mixing unrelated quantities', () => {
  const transactions = [
    { id: 1, type: 'IN', timestamp: '2026-09-20T08:00:00.000Z', itemId: 1, quantity: 10, unitPrice: 500, totalAmount: 5000 },
    { id: 2, type: 'OUT', timestamp: '2026-09-20T09:00:00.000Z', itemId: 1, quantity: 4, unitPrice: 750, totalAmount: 3000, totalCostAmount: 2000 },
    { id: 3, type: 'IN', timestamp: '2026-09-21T08:00:00.000Z', itemId: 2, quantity: 20, unitPrice: 300, totalAmount: 6000 },
    { id: 4, type: 'OUT', timestamp: '2026-09-21T09:00:00.000Z', itemId: 2, quantity: 6, unitPrice: 450, totalAmount: 2700, totalCostAmount: 1800 },
  ];

  const result = computeProfitSummary({
    transactions,
    items: [itemA, itemB],
    fromDate: '2026-09-20',
    toDate: '2026-09-21',
  });

  assert.equal(result.totals.stockInCost, 5000 + 6000);
  assert.equal(result.totals.stockOutSales, 3000 + 2700);
  assert.equal(result.totals.stockOutCost, 2000 + 1800);
  assert.equal(result.totals.profit, 3000 + 2700, 'profit totals = sum of Stock-Out amounts');

  assert.equal(result.rows.length, 2, 'one row per day in range');
});

test('includes zero-activity days within the selected range', () => {
  const transactions = [
    { id: 1, type: 'IN', timestamp: '2026-09-22T08:00:00.000Z', itemId: 1, quantity: 10, unitPrice: 500, totalAmount: 5000 },
  ];

  const result = computeProfitSummary({
    transactions,
    items: [itemA],
    fromDate: '2026-09-20',
    toDate: '2026-09-22',
  });

  assert.equal(result.rows.length, 3);
  const emptyDay = result.rows.find(row => row.date === '2026-09-21');
  assert.equal(emptyDay.profit, 0);
  assert.equal(emptyDay.stockInCount, 0);
  assert.equal(emptyDay.stockOutCount, 0);
});

test('computes total stock value from current inventory at cost', () => {
  const result = computeProfitSummary({ transactions: [], items: [itemA, itemB], fromDate: '2026-09-20', toDate: '2026-09-20' });
  assert.equal(result.totalStockValue, 100 * 500 + 50 * 300);
});
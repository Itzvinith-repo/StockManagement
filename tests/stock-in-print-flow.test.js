import test from 'node:test';
import assert from 'node:assert/strict';

import { createStockInPrintSubmitController } from '../src/stockInFlow.js';

test('print success triggers stock-in submit once', async () => {
  const controller = createStockInPrintSubmitController();
  const calls = [];

  const result = await controller.run({
    printFn: async () => {
      calls.push('print');
    },
    submitFn: async () => {
      calls.push('submit');
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['print', 'submit']);
});

test('print failure prevents stock-in submit', async () => {
  const controller = createStockInPrintSubmitController();
  const calls = [];

  const result = await controller.run({
    printFn: async () => {
      calls.push('print');
      throw new Error('Printer not available');
    },
    submitFn: async () => {
      calls.push('submit');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.duplicate, false);
  assert.match(result.message, /Printer not available/i);
  assert.deepEqual(calls, ['print']);
});

test('duplicate clicks while processing are ignored', async () => {
  const controller = createStockInPrintSubmitController();
  let printRuns = 0;
  let submitRuns = 0;

  const first = controller.run({
    printFn: async () => {
      printRuns += 1;
      await new Promise(resolve => setTimeout(resolve, 40));
    },
    submitFn: async () => {
      submitRuns += 1;
    },
  });

  const second = controller.run({
    printFn: async () => {
      printRuns += 1;
    },
    submitFn: async () => {
      submitRuns += 1;
    },
  });

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, false);
  assert.equal(secondResult.duplicate, true);
  assert.equal(printRuns, 1);
  assert.equal(submitRuns, 1);
});

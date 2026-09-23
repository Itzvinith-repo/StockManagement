export function computeProfitSummary({ transactions = [], items = [], fromDate, toDate }) {
  const startDate = fromDate || new Date(new Date().getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const endDate = toDate || new Date().toISOString().slice(0, 10);

  const todayStr = new Date().toISOString().slice(0, 10);

  const costForTx = tx => {
    const storedCost = Number(tx.totalCostAmount || 0);
    if (storedCost > 0) return storedCost;
    const item = items.find(i => Number(i.id) === Number(tx.itemId));
    const costPrice = Number(item?.unitPrice || tx.unitPrice || 0);
    return Number(tx.quantity || 0) * costPrice;
  };

  const salesForTx = tx => {
    const storedSales = Number(tx.totalWholesaleAmount || 0);
    if (storedSales > 0) return storedSales;
    return Number(tx.quantity || 0) * Number(tx.unitPrice || 0);
  };

  const dayMap = new Map();
  const seedDay = dateStr => {
    if (!dayMap.has(dateStr)) {
      dayMap.set(dateStr, { date: dateStr, stockInCost: 0, stockOutSales: 0, stockOutCost: 0, profit: 0, stockInCount: 0, stockOutCount: 0 });
    }
  };

  const addDays = (dateStr, days) => {
    const d = new Date(`${dateStr}T12:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  let cursorDate = startDate;
  while (cursorDate <= endDate) {
    seedDay(cursorDate);
    cursorDate = addDays(cursorDate, 1);
    if (cursorDate === addDays(endDate, 1)) break;
    if (cursorDate > endDate) break;
  }

  transactions.forEach(tx => {
    const txDate = tx.timestamp ? new Date(tx.timestamp).toISOString().slice(0, 10) : '';
    if (!txDate) return;
    if (txDate < startDate || txDate > endDate) return;

    seedDay(txDate);
    const day = dayMap.get(txDate);

    if (tx.type === 'IN') {
      const cost = Number(tx.totalCostAmount || tx.totalAmount || 0) || costForTx(tx);
      day.stockInCost += cost;
      day.stockInCount += 1;
    } else if (tx.type === 'OUT') {
      const sales = salesForTx(tx);
      const cost = costForTx(tx);
      day.stockOutSales += sales;
      day.stockOutCost += cost;
      day.stockOutCount += 1;
      day.profit += sales;
    }
  });

  const rows = [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date));

  const today = dayMap.get(todayStr) || { stockInCost: 0, stockOutSales: 0, stockOutCost: 0, profit: 0, stockInCount: 0, stockOutCount: 0 };

  let totalStockValue = 0;
  items.forEach(item => {
    totalStockValue += Number(item.quantity || 0) * Number(item.unitPrice || 0);
  });

  const totals = rows.reduce((acc, day) => {
    acc.stockInCost += day.stockInCost;
    acc.stockOutSales += day.stockOutSales;
    acc.stockOutCost += day.stockOutCost;
    acc.profit += day.profit;
    acc.stockInCount += day.stockInCount;
    acc.stockOutCount += day.stockOutCount;
    return acc;
  }, { stockInCost: 0, stockOutSales: 0, stockOutCost: 0, profit: 0, stockInCount: 0, stockOutCount: 0 });

  return { rows, totals, today, totalStockValue, todayStr, startDate, endDate };
}
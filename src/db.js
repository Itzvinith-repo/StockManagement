import Dexie from 'dexie';
import { supabase, isSupabaseConfigured } from './supabase.js';

export const db = new Dexie('WholesaleDressStockDB_LKR');

db.version(1).stores({
  items: '++id, name, supplierName, quantity, unitPrice, totalValue, createdAt',
  transactions: '++id, type, timestamp, itemId, itemName, supplierName, customerName, referenceNo, quantity, unitPrice, totalAmount, reasonCode'
});

db.version(2).stores({
  items: '++id, name, supplierName, quantity, unitPrice, totalValue, createdAt',
  transactions: '++id, type, timestamp, itemId, itemName, supplierName, customerName, referenceNo, quantity, unitPrice, totalAmount, reasonCode',
  vendors: '++id, name, contact, createdAt'
});

const mapItemRow = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description ?? '',
  supplierName: row.supplier_name ?? row.supplierName ?? 'General Supplier',
  supplierContact: row.supplier_contact ?? row.supplierContact ?? '',
  quantity: Number(row.quantity ?? 0),
  unitPrice: Number(row.unit_price ?? row.unitPrice ?? 0),
  totalValue: Number(row.total_value ?? row.totalValue ?? 0),
  createdAt: row.created_at ?? row.createdAt,
  updatedAt: row.updated_at ?? row.updatedAt,
  variants: [],
  totalStock: Number(row.quantity ?? 0),
});

const mapTransactionRow = (row) => ({
  id: row.id,
  type: row.type,
  timestamp: row.transaction_time ?? row.timestamp,
  itemId: row.item_id ?? row.itemId,
  itemName: row.item_name ?? row.itemName ?? '',
  supplierName: row.supplier_name ?? row.supplierName ?? '',
  customerName: row.customer_name ?? row.customerName ?? '',
  referenceNo: row.reference_no ?? row.referenceNo ?? 'N/A',
  quantity: Number(row.quantity ?? 0),
  unitPrice: Number(row.unit_price ?? row.unitPrice ?? 0),
  totalAmount: Number(row.total_amount ?? row.totalAmount ?? 0),
  reasonCode: row.reason_code ?? row.reasonCode ?? '',
  notes: row.notes ?? '',
  description: row.description ?? '',
  totalWholesaleAmount: Number(row.total_wholesale_amount ?? row.totalWholesaleAmount ?? 0),
  totalCostAmount: Number(row.total_cost_amount ?? row.totalCostAmount ?? 0),
  wholesalePrice: Number(row.wholesale_price ?? row.wholesalePrice ?? 0),
});

const mapItemToSupabaseInsert = (itemData) => ({
  name: itemData.name,
  description: itemData.description || '',
  supplier_name: itemData.supplierName || 'General Supplier',
  supplier_contact: itemData.supplierContact || '',
  quantity: Math.max(0, Number(itemData.quantity) || 0),
  unit_price: Number(itemData.unitPrice) || 0,
  total_value: Number(itemData.totalValue) || 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

async function getLocalItems() {
  const items = await db.items.toArray();
  return items.map(item => ({
    ...item,
    description: item.description ?? '',
    supplierName: item.supplierName ?? 'General Supplier',
    supplierContact: item.supplierContact ?? '',
    quantity: Number(item.quantity ?? 0),
    unitPrice: Number(item.unitPrice ?? 0),
    totalValue: Number(item.totalValue ?? 0),
    variants: [],
    totalStock: Number(item.quantity ?? 0),
  }));
}

async function getLocalTransactions() {
  const txs = await db.transactions.reverse().toArray();
  return txs;
}

async function getRemoteItems() {
  if (!supabase) return getLocalItems();

  const { data: items = [], error: itemsError } = await supabase.from('items').select('*');
  if (itemsError) throw itemsError;

  return (items || []).map(item => ({
    ...mapItemRow(item),
    variants: [],
    totalStock: Number(item.quantity ?? 0),
  }));
}

async function getRemoteTransactions() {
  if (!supabase) return getLocalTransactions();

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('transaction_time', { ascending: false });

  if (error) throw error;
  return (data || []).map(mapTransactionRow);
}

export async function getAllItems() {
  if (isSupabaseConfigured()) {
    return getRemoteItems();
  }
  return getLocalItems();
}

export async function getAllVendors() {
  if (isSupabaseConfigured()) {
    const [{ data: vendors = [], error: vendorError }, { data: items = [], error: itemError }, { data: transactions = [], error: transactionError }] = await Promise.all([
      supabase.from('vendors').select('*').order('name'),
      supabase.from('items').select('supplier_name'),
      supabase.from('transactions').select('supplier_name'),
    ]);
    if (vendorError) throw vendorError;
    if (itemError) throw itemError;
    if (transactionError) throw transactionError;
    const names = new Map((vendors || []).map(vendor => [vendor.name.trim().toLowerCase(), {
      id: vendor.id,
      name: vendor.name,
      contact: vendor.contact || '',
      createdAt: vendor.created_at,
    }]));
    [...(items || []), ...(transactions || [])].forEach(row => {
      const name = (row.supplier_name || '').trim();
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), { id: `legacy-${name}`, name, contact: '' });
    });
    return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const [vendors, items, transactions] = await Promise.all([
    db.vendors.toArray(),
    db.items.toArray(),
    db.transactions.toArray(),
  ]);
  const names = new Map(vendors.map(vendor => [vendor.name.trim().toLowerCase(), vendor]));
  [...items, ...transactions].forEach(row => {
    const name = (row.supplierName || '').trim();
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), { id: `legacy-${name}`, name, contact: '' });
  });
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function addVendor({ name, contact = '' }) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) throw new Error('Vendor name is required.');
  const existing = (await getAllVendors()).find(vendor => vendor.name.toLowerCase() === normalizedName.toLowerCase());
  if (existing) throw new Error('This vendor already exists.');

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.from('vendors').insert([{
      name: normalizedName,
      contact: String(contact || '').trim(),
    }]).select().single();
    if (error) throw error;
    return data.id;
  }

  return db.vendors.add({
    name: normalizedName,
    contact: String(contact || '').trim(),
    createdAt: new Date().toISOString(),
  });
}

export async function updateVendor(id, { oldName, name, contact = '' }) {
  const vendorId = Number(id);
  const normalizedName = String(name || '').trim();
  const previousName = String(oldName || '').trim();
  if (!vendorId || !normalizedName || !previousName) throw new Error('Valid vendor details are required.');

  if (isSupabaseConfigured()) {
    const duplicate = await supabase.from('vendors').select('id').ilike('name', normalizedName).neq('id', vendorId).maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) throw new Error('This vendor already exists.');

    const { error: vendorError } = await supabase.from('vendors').update({
      name: normalizedName,
      contact: String(contact || '').trim(),
    }).eq('id', vendorId);
    if (vendorError) throw vendorError;

    const { error: itemError } = await supabase.from('items').update({ supplier_name: normalizedName, supplier_contact: String(contact || '').trim() }).ilike('supplier_name', previousName);
    if (itemError) throw itemError;
    const { error: transactionError } = await supabase.from('transactions').update({ supplier_name: normalizedName }).ilike('supplier_name', previousName);
    if (transactionError) throw transactionError;
    return;
  }

  const duplicate = (await db.vendors.toArray()).find(vendor => vendor.id !== vendorId && vendor.name.toLowerCase() === normalizedName.toLowerCase());
  if (duplicate) throw new Error('This vendor already exists.');
  await db.transaction('rw', db.vendors, db.items, db.transactions, async () => {
    const updated = await db.vendors.update(vendorId, { name: normalizedName, contact: String(contact || '').trim() });
    if (!updated) throw new Error('Vendor not found.');
    const items = await db.items.where('supplierName').equals(previousName).toArray();
    await Promise.all(items.map(item => db.items.update(item.id, { supplierName: normalizedName, supplierContact: String(contact || '').trim() })));
    const transactions = await db.transactions.where('supplierName').equals(previousName).toArray();
    await Promise.all(transactions.map(transaction => db.transactions.update(transaction.id, { supplierName: normalizedName })));
  });
}

export async function deleteVendor(id, name) {
  const vendorId = Number(id);
  const normalizedName = String(name || '').trim();
  if (!vendorId || !normalizedName) throw new Error('Valid vendor is required.');

  if (isSupabaseConfigured()) {
    const [{ count: itemCount, error: itemError }, { count: transactionCount, error: transactionError }] = await Promise.all([
      supabase.from('items').select('id', { count: 'exact', head: true }).ilike('supplier_name', normalizedName),
      supabase.from('transactions').select('id', { count: 'exact', head: true }).ilike('supplier_name', normalizedName),
    ]);
    if (itemError) throw itemError;
    if (transactionError) throw transactionError;
    if ((itemCount || 0) > 0 || (transactionCount || 0) > 0) throw new Error('This vendor is linked to stock records and cannot be deleted.');
    const { error } = await supabase.from('vendors').delete().eq('id', vendorId);
    if (error) throw error;
    return;
  }

  const [itemCount, transactionCount] = await Promise.all([
    db.items.where('supplierName').equals(normalizedName).count(),
    db.transactions.where('supplierName').equals(normalizedName).count(),
  ]);
  if (itemCount || transactionCount) throw new Error('This vendor is linked to stock records and cannot be deleted.');
  const deleted = await db.vendors.delete(vendorId);
  if (!deleted) throw new Error('Vendor not found.');
}

export async function getItemById(id) {
  if (isSupabaseConfigured()) {
    const itemId = Number(id);
    const { data: item, error } = await supabase
      .from('items')
      .select('*')
      .eq('id', itemId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    if (!item) return null;
    return { ...mapItemRow(item), variants: [], totalStock: Number(item.quantity ?? 0) };
  }

  const item = await db.items.get(Number(id));
  if (!item) return null;
  return {
    ...item,
    description: item.description ?? '',
    quantity: Number(item.quantity ?? 0),
    unitPrice: Number(item.unitPrice ?? 0),
    totalValue: Number(item.totalValue ?? 0),
    variants: [],
    totalStock: Number(item.quantity ?? 0),
  };
}

export async function addDressItem(itemData) {
  const normalized = {
    name: itemData.name,
    description: itemData.description || '',
    supplierName: itemData.supplierName || 'General Supplier',
    supplierContact: itemData.supplierContact || '',
    quantity: 0,
    unitPrice: Number(itemData.unitPrice) || 0,
    totalValue: 0,
  };

  if (isSupabaseConfigured()) {
    const { data: itemRecord, error: itemError } = await supabase
      .from('items')
      .insert([mapItemToSupabaseInsert(normalized)])
      .select()
      .single();

    if (itemError) throw itemError;
    return itemRecord.id;
  }

  return await db.items.add({
    ...normalized,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function updateDressItem(id, itemData) {
  const normalized = {
    name: itemData.name,
    description: itemData.description || '',
    supplierName: itemData.supplierName,
    supplierContact: itemData.supplierContact || '',
    quantity: Math.max(0, Number(itemData.quantity) || 0),
    unitPrice: Number(itemData.unitPrice) || 0,
    totalValue: Number(itemData.totalValue) || 0,
  };

  if (isSupabaseConfigured()) {
    const itemId = Number(id);
    const { error: itemError } = await supabase.from('items').update({
      name: normalized.name,
      description: normalized.description,
      supplier_name: normalized.supplierName,
      supplier_contact: normalized.supplierContact,
      quantity: normalized.quantity,
      unit_price: normalized.unitPrice,
      total_value: normalized.totalValue,
      updated_at: new Date().toISOString(),
    }).eq('id', itemId);

    if (itemError) throw itemError;
    return;
  }

  return await db.items.update(Number(id), {
    ...normalized,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteDressItem(id) {
  const itemId = Number(id);

  if (isSupabaseConfigured()) {
    const { error: itemError } = await supabase.from('items').delete().eq('id', itemId);
    if (itemError) throw itemError;
    return;
  }

  return await db.transaction('rw', db.items, db.transactions, async () => {
    await db.transactions.where({ itemId }).delete();
    await db.items.delete(itemId);
  });
}

export async function processStockIn(data) {
  const qty = Number(data.quantity) || 0;
  const unitPrice = Number(data.unitPrice) || 0;
  const timestamp = data.timestamp || new Date().toISOString();

  if (isSupabaseConfigured()) {
    const itemId = Number(data.itemId);
    const { data: item, error: itemError } = await supabase.from('items').select('*').eq('id', itemId).single();
    if (itemError) throw itemError;
    if (!item) throw new Error('Dress item not found');

    const nextQty = Number(item.quantity || 0) + qty;
    const nextValue = nextQty * (unitPrice || Number(item.unit_price || 0));

    const { error: updateError } = await supabase.from('items').update({
      quantity: nextQty,
      unit_price: unitPrice || Number(item.unit_price || 0),
      total_value: nextValue,
      supplier_name: data.supplierName || item.supplier_name,
      updated_at: new Date().toISOString(),
    }).eq('id', itemId);

    if (updateError) throw updateError;

    const { error: transactionError } = await supabase.from('transactions').insert([{
      type: 'IN',
      transaction_time: timestamp,
      item_id: itemId,
      item_name: item.name,
      supplier_name: data.supplierName || item.supplier_name,
      customer_name: data.customerName || '',
      reference_no: data.referenceNo || 'N/A',
      quantity: qty,
      unit_price: unitPrice || Number(item.unit_price || 0),
      total_amount: qty * (unitPrice || Number(item.unit_price || 0)),
      reason_code: data.reasonCode || 'Stock Receiving',
      notes: data.notes || '',
    }]);

    if (transactionError) throw transactionError;
    return;
  }

  return await db.transaction('rw', db.items, db.transactions, async () => {
    const itemId = Number(data.itemId);
    const item = await db.items.get(itemId);
    if (!item) throw new Error('Dress item not found');

    const nextQuantity = Number(item.quantity || 0) + qty;
    const usedPrice = unitPrice || Number(item.unitPrice || 0);
    const nextTotalValue = nextQuantity * usedPrice;

    await db.items.update(itemId, {
      quantity: nextQuantity,
      unitPrice: usedPrice,
      totalValue: nextTotalValue,
      supplierName: data.supplierName || item.supplierName,
      updatedAt: new Date().toISOString(),
    });

    await db.transactions.add({
      type: 'IN',
      timestamp,
      itemId,
      itemName: item.name,
      supplierName: data.supplierName || item.supplierName,
      customerName: data.customerName || '',
      referenceNo: data.referenceNo || 'N/A',
      quantity: qty,
      unitPrice: usedPrice,
      totalAmount: qty * usedPrice,
      reasonCode: data.reasonCode || 'Stock Receiving',
      notes: data.notes || '',
      description: item.description || '',
    });
  });
}

export async function processStockOut(data) {
  const qty = Number(data.quantity) || 0;
  const timestamp = data.timestamp || new Date().toISOString();

  if (isSupabaseConfigured()) {
    const itemId = Number(data.itemId);
    const { data: item, error: itemError } = await supabase.from('items').select('*').eq('id', itemId).single();
    if (itemError) throw itemError;
    if (!item) throw new Error('Dress item not found');

    const currentQty = Number(item.quantity || 0);
    if (currentQty < qty) {
      throw new Error(`Insufficient stock for ${item.name}. Available: ${currentQty}, Requested: ${qty}.`);
    }

    const nextQty = currentQty - qty;
    const unitPrice = Number(item.unit_price || 0);
    const nextTotalValue = nextQty * unitPrice;

    const { error: updateError } = await supabase.from('items').update({
      quantity: nextQty,
      total_value: nextTotalValue,
      updated_at: new Date().toISOString(),
    }).eq('id', itemId);

    if (updateError) throw updateError;

    const { error: transactionError } = await supabase.from('transactions').insert([{
      type: 'OUT',
      transaction_time: timestamp,
      item_id: itemId,
      item_name: item.name,
      supplier_name: data.supplierName || item.supplier_name || '',
      customer_name: data.customerName || 'N/A',
      reference_no: data.referenceNo || 'N/A',
      quantity: qty,
      unit_price: unitPrice,
      total_amount: qty * unitPrice,
      reason_code: data.reasonCode || 'Wholesale Customer Sale',
      notes: data.notes || '',
    }]);

    if (transactionError) throw transactionError;
    return;
  }

  return await db.transaction('rw', db.items, db.transactions, async () => {
    const itemId = Number(data.itemId);
    const item = await db.items.get(itemId);
    if (!item) throw new Error('Dress item not found');

    const currentQty = Number(item.quantity || 0);
    if (currentQty < qty) {
      throw new Error(`Insufficient stock for ${item.name}. Available: ${currentQty}, Requested: ${qty}.`);
    }

    const nextQty = currentQty - qty;
    const usedPrice = Number(item.unitPrice || 0);

    await db.items.update(itemId, {
      quantity: nextQty,
      totalValue: nextQty * usedPrice,
      updatedAt: new Date().toISOString(),
    });

    await db.transactions.add({
      type: 'OUT',
      timestamp,
      itemId,
      itemName: item.name,
      supplierName: data.supplierName || item.supplierName || '',
      customerName: data.customerName || 'N/A',
      referenceNo: data.referenceNo || 'N/A',
      quantity: qty,
      unitPrice: usedPrice,
      totalAmount: qty * usedPrice,
      reasonCode: data.reasonCode || 'Wholesale Customer Sale',
      notes: data.notes || '',
      description: item.description || '',
    });
  });
}

export async function getAllTransactions() {
  if (isSupabaseConfigured()) {
    return getRemoteTransactions();
  }
  return getLocalTransactions();
}

export async function updateTransactionSupplierAndDate(id, { supplierName, date }) {
  const transactionId = Number(id);
  const normalizedSupplier = String(supplierName || '').trim();
  if (!transactionId) throw new Error('Valid transaction is required.');
  if (!normalizedSupplier) throw new Error('Supplier name is required.');
  if (!date) throw new Error('Transaction date is required.');

  const timestamp = new Date(`${date}T12:00:00`).toISOString();

  if (isSupabaseConfigured()) {
    const { error } = await supabase.from('transactions').update({
      supplier_name: normalizedSupplier,
      transaction_time: timestamp,
    }).eq('id', transactionId);
    if (error) throw error;
    return;
  }

  const updated = await db.transactions.update(transactionId, {
    supplierName: normalizedSupplier,
    timestamp,
  });
  if (!updated) throw new Error('Transaction not found.');
}

export async function recordStockCorrection({
  itemId,
  quantity,
  reasonCode = 'Stock Correction / Restock',
  notes = '',
  timestamp = new Date().toISOString(),
  supplierName = '',
  customerName = '',
  referenceNo = 'N/A',
}) {
  const qty = Number(quantity) || 0;
  const itemIdNum = Number(itemId);
  if (!itemIdNum) throw new Error('Valid item is required for correction.');
  if (qty <= 0) throw new Error('Correction quantity must be greater than zero.');

  if (isSupabaseConfigured()) {
    const { data: item, error: itemError } = await supabase
      .from('items')
      .select('*')
      .eq('id', itemIdNum)
      .single();

    if (itemError) throw itemError;
    if (!item) throw new Error('Dress item not found.');

    const nextQty = Number(item.quantity || 0) + qty;
    const unitPrice = Number(item.unit_price || 0);
    const nextTotalValue = nextQty * unitPrice;

    const { error: updateError } = await supabase
      .from('items')
      .update({
        quantity: nextQty,
        total_value: nextTotalValue,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemIdNum);

    if (updateError) throw updateError;

    const { error: transactionError } = await supabase.from('transactions').insert([{
      type: 'IN',
      transaction_time: timestamp,
      item_id: itemIdNum,
      item_name: item.name,
      supplier_name: supplierName || item.supplier_name || '',
      customer_name: customerName || '',
      reference_no: referenceNo || 'N/A',
      quantity: qty,
      unit_price: unitPrice,
      total_amount: qty * unitPrice,
      reason_code: reasonCode || 'Stock Correction / Restock',
      notes: notes || 'Stock correction / restock to fix a mistaken stock-out.',
    }]);

    if (transactionError) throw transactionError;
    return;
  }

  return await db.transaction('rw', db.items, db.transactions, async () => {
    const item = await db.items.get(itemIdNum);
    if (!item) throw new Error('Dress item not found.');

    const nextQty = Number(item.quantity || 0) + qty;
    const unitPrice = Number(item.unitPrice || 0);
    await db.items.update(itemIdNum, {
      quantity: nextQty,
      totalValue: nextQty * unitPrice,
      updatedAt: new Date().toISOString(),
    });

    await db.transactions.add({
      type: 'IN',
      timestamp,
      itemId: itemIdNum,
      itemName: item.name,
      supplierName: supplierName || item.supplierName || '',
      customerName: customerName || '',
      referenceNo: referenceNo || 'N/A',
      quantity: qty,
      unitPrice,
      totalAmount: qty * unitPrice,
      reasonCode: reasonCode || 'Stock Correction / Restock',
      notes: notes || 'Stock correction / restock to fix a mistaken stock-out.',
      description: item.description || '',
    });
  });
}

export async function getSupplierDailyStockInSummary({ supplierName = '', date = '' } = {}) {
  const transactions = await getAllTransactions();

  const filtered = transactions.filter(tx => {
    if (tx.type !== 'IN') return false;
    const txDate = new Date(tx.timestamp || new Date()).toISOString().slice(0, 10);

    const matchesSupplier = !supplierName || (tx.supplierName || '').toLowerCase() === supplierName.toLowerCase();
    const matchesDate = !date || txDate === date;
    return matchesSupplier && matchesDate;
  });

  const groups = new Map();
  filtered.forEach(tx => {
    const txDate = new Date(tx.timestamp || new Date()).toISOString().slice(0, 10);
    const key = `${txDate}::${(tx.supplierName || 'General Supplier').trim() || 'General Supplier'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        date: txDate,
        supplierName: tx.supplierName || 'General Supplier',
        transactions: [],
      });
    }
    groups.get(key).transactions.push(tx);
  });

  return [...groups.values()].map(group => {
    const totalQty = group.transactions.reduce((sum, tx) => sum + Number(tx.quantity || 0), 0);
    const totalAmount = group.transactions.reduce((sum, tx) => sum + Number(tx.totalAmount || 0), 0);
    return {
      date: group.date,
      supplierName: group.supplierName,
      totalQty,
      totalAmount,
      transactionCount: group.transactions.length,
      items: group.transactions.map(tx => ({
        itemName: tx.itemName || 'Dress Item',
        quantity: Number(tx.quantity || 0),
        unitPrice: Number(tx.unitPrice || 0),
        totalAmount: Number(tx.totalAmount || 0),
        referenceNo: tx.referenceNo || 'N/A',
        notes: tx.notes || '',
        time: tx.timestamp,
      })),
    };
  });
}

export async function clearAllTransactions() {
  if (isSupabaseConfigured()) {
    const { error } = await supabase.from('transactions').delete().neq('id', 0);
    if (error) throw error;
    return;
  }

  await db.transactions.clear();
}

export async function exportDatabaseJSON(options = {}) {
  const items = await getAllItems();
  const transactions = await getAllTransactions();
  const vendors = await getAllVendors();

  const payload = {
    appName: 'DressStock Shop',
    appVersion: '1.0.0',
    exportDate: new Date().toISOString(),
    deviceName: options.deviceName || 'Unknown Device',
    data: {
      items: items.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        supplierName: item.supplierName || 'General Supplier',
        supplierContact: item.supplierContact || '',
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        totalValue: Number(item.totalValue || 0),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
      })),
      transactions,
      vendors: vendors.filter(vendor => !String(vendor.id).startsWith('legacy-')).map(vendor => ({
        id: typeof vendor.id === 'number' ? vendor.id : undefined,
        name: vendor.name,
        contact: vendor.contact || '',
        createdAt: vendor.createdAt || new Date().toISOString(),
      }))
    }
  };

  return JSON.stringify(payload, null, 2);
}

export async function importDatabaseJSON(jsonString) {
  const data = JSON.parse(jsonString);
  const safeData = data.data || data;

  await db.transaction('rw', db.items, db.transactions, db.vendors, async () => {
    await db.items.clear();
    await db.transactions.clear();
    await db.vendors.clear();

    if (safeData.items) await db.items.bulkAdd(safeData.items);
    if (safeData.transactions) await db.transactions.bulkAdd(safeData.transactions);
    if (safeData.vendors) await db.vendors.bulkAdd(safeData.vendors.map(vendor => ({
      ...vendor,
      id: undefined,
    })));
  });
}

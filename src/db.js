import Dexie from 'dexie';
import { supabase, isSupabaseConfigured } from './supabase.js';

export const db = new Dexie('WholesaleDressStockDB_LKR');

db.version(1).stores({
  items: '++id, name, supplierName, quantity, unitPrice, totalValue, createdAt',
  transactions: '++id, type, timestamp, itemId, itemName, supplierName, customerName, referenceNo, quantity, unitPrice, totalAmount, reasonCode'
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
    quantity: Math.max(0, Number(itemData.quantity) || 0),
    unitPrice: Number(itemData.unitPrice) || 0,
    totalValue: Number(itemData.totalValue) || 0,
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
      supplier_name: item.supplier_name || '',
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
      supplierName: item.supplierName || '',
      customerName: data.customerName || 'N/A',
      referenceNo: data.referenceNo || 'N/A',
      quantity: qty,
      unitPrice: usedPrice,
      totalAmount: qty * usedPrice,
      reasonCode: data.reasonCode || 'Wholesale Customer Sale',
      notes: data.notes || '',
    });
  });
}

export async function getAllTransactions() {
  if (isSupabaseConfigured()) {
    return getRemoteTransactions();
  }
  return getLocalTransactions();
}

export async function exportDatabaseJSON(options = {}) {
  const items = await getAllItems();
  const transactions = await getAllTransactions();

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
      transactions
    }
  };

  return JSON.stringify(payload, null, 2);
}

export async function importDatabaseJSON(jsonString) {
  const data = JSON.parse(jsonString);
  const safeData = data.data || data;

  await db.transaction('rw', db.items, db.transactions, async () => {
    await db.items.clear();
    await db.transactions.clear();

    if (safeData.items) await db.items.bulkAdd(safeData.items);
    if (safeData.transactions) await db.transactions.bulkAdd(safeData.transactions);
  });
}

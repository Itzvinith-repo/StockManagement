import Dexie from 'dexie';
import { supabase, isSupabaseConfigured } from './supabase.js';

export const db = new Dexie('WholesaleDressStockDB_LKR');

db.version(1).stores({
  items: '++id, name, supplierName, unitCost, wholesalePrice, createdAt',
  variants: '++id, itemId, size, color, stockQuantity, [itemId+size+color]',
  transactions: '++id, type, timestamp, itemId, supplierName, customerName, referenceNo, size, color, quantity, unitCost, wholesalePrice, reasonCode'
});

const mapItemRow = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description ?? '',
  supplierName: row.supplier_name ?? row.supplierName ?? 'General Supplier',
  supplierContact: row.supplier_contact ?? row.supplierContact ?? '',
  unitCost: Number(row.unit_cost ?? row.unitCost ?? 0),
  wholesalePrice: Number(row.wholesale_price ?? row.wholesalePrice ?? 0),
  createdAt: row.created_at ?? row.createdAt,
  updatedAt: row.updated_at ?? row.updatedAt,
});

const mapVariantRow = (row) => ({
  id: row.id,
  itemId: row.item_id ?? row.itemId,
  size: row.size,
  color: row.color,
  stockQuantity: Number(row.stock_quantity ?? row.stockQuantity ?? 0),
});

const mapTransactionRow = (row) => ({
  id: row.id,
  type: row.type,
  timestamp: row.transaction_time ?? row.timestamp,
  itemId: row.item_id ?? row.itemId,
  itemName: row.item_name ?? row.itemName,
  supplierName: row.supplier_name ?? row.supplierName ?? '',
  customerName: row.customer_name ?? row.customerName ?? '',
  referenceNo: row.reference_no ?? row.referenceNo ?? 'N/A',
  size: row.size,
  color: row.color,
  quantity: Number(row.quantity ?? 0),
  unitCost: Number(row.unit_cost ?? row.unitCost ?? 0),
  wholesalePrice: Number(row.wholesale_price ?? row.wholesalePrice ?? 0),
  reasonCode: row.reason_code ?? row.reasonCode ?? '',
  totalCostAmount: Number(row.total_cost_amount ?? row.totalCostAmount ?? 0),
  totalWholesaleAmount: Number(row.total_wholesale_amount ?? row.totalWholesaleAmount ?? 0),
  notes: row.notes ?? '',
});

const mapItemToSupabaseInsert = (itemData) => ({
  name: itemData.name,
  description: itemData.description || '',
  supplier_name: itemData.supplierName || 'General Supplier',
  supplier_contact: itemData.supplierContact || '',
  unit_cost: Number(itemData.unitCost) || 0,
  wholesale_price: Number(itemData.wholesalePrice) || 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const mapVariantToSupabaseInsert = (itemId, variantData) => ({
  item_id: Number(itemId),
  size: variantData.size,
  color: variantData.color,
  stock_quantity: Math.max(0, Number(variantData.quantity) || 0),
});

async function getLocalItems() {
  const items = await db.items.toArray();
  const variants = await db.variants.toArray();
  return items.map(item => {
    const itemVariants = variants.filter(v => v.itemId === item.id);
    const totalStock = itemVariants.reduce((sum, v) => sum + (v.stockQuantity || 0), 0);
    return { ...item, variants: itemVariants, totalStock };
  });
}

async function getLocalTransactions() {
  const txs = await db.transactions.reverse().toArray();
  return txs;
}

async function getRemoteItems() {
  if (!supabase) return getLocalItems();

  const [{ data: items = [], error: itemsError }, { data: variants = [], error: variantsError }] = await Promise.all([
    supabase.from('items').select('*'),
    supabase.from('variants').select('*')
  ]);

  if (itemsError) throw itemsError;
  if (variantsError) throw variantsError;

  return (items || []).map(item => {
    const itemVariants = (variants || []).filter(v => Number(v.item_id ?? v.itemId) === Number(item.id));
    const totalStock = itemVariants.reduce((sum, variant) => sum + Number(variant.stock_quantity ?? variant.stockQuantity ?? 0), 0);
    return {
      ...mapItemRow(item),
      variants: itemVariants.map(mapVariantRow),
      totalStock,
    };
  });
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

    const { data: variants = [] } = await supabase
      .from('variants')
      .select('*')
      .eq('item_id', itemId);

    const itemVariants = (variants || []).map(mapVariantRow);
    const totalStock = itemVariants.reduce((sum, variant) => sum + Number(variant.stockQuantity || 0), 0);

    return { ...mapItemRow(item), variants: itemVariants, totalStock };
  }

  const item = await db.items.get(Number(id));
  if (!item) return null;
  const itemVariants = await db.variants.where({ itemId: Number(id) }).toArray();
  const totalStock = itemVariants.reduce((sum, v) => sum + (v.stockQuantity || 0), 0);
  return { ...item, variants: itemVariants, totalStock };
}

export async function addDressItem(itemData, variantsData = []) {
  if (isSupabaseConfigured()) {
    const { data: itemRecord, error: itemError } = await supabase
      .from('items')
      .insert([mapItemToSupabaseInsert(itemData)])
      .select()
      .single();

    if (itemError) throw itemError;

    const itemId = itemRecord.id;
    if (variantsData.length > 0) {
      const variantRows = variantsData.map(v => mapVariantToSupabaseInsert(itemId, v));
      const { error: variantsError } = await supabase.from('variants').insert(variantRows);
      if (variantsError) throw variantsError;
    }

    return itemId;
  }

  return await db.transaction('rw', db.items, db.variants, async () => {
    const itemId = await db.items.add({
      name: itemData.name,
      description: itemData.description || '',
      supplierName: itemData.supplierName || 'General Supplier',
      supplierContact: itemData.supplierContact || '',
      unitCost: Number(itemData.unitCost) || 0,
      wholesalePrice: Number(itemData.wholesalePrice) || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    for (const v of variantsData) {
      await db.variants.add({
        itemId,
        size: v.size,
        color: v.color,
        stockQuantity: Math.max(0, Number(v.quantity) || 0)
      });
    }

    return itemId;
  });
}

export async function updateDressItem(id, itemData) {
  if (isSupabaseConfigured()) {
    const itemId = Number(id);

    const { error: itemError } = await supabase.from('items').update({
      name: itemData.name,
      description: itemData.description || '',
      supplier_name: itemData.supplierName,
      supplier_contact: itemData.supplierContact,
      unit_cost: Number(itemData.unitCost) || 0,
      wholesale_price: Number(itemData.wholesalePrice) || 0,
      updated_at: new Date().toISOString(),
    }).eq('id', itemId);

    if (itemError) throw itemError;

    if (itemData.variants) {
      const upserts = itemData.variants.map(v => ({
        item_id: itemId,
        size: v.size,
        color: v.color,
        stock_quantity: Math.max(0, Number(v.quantity) || 0),
      }));

      const { error: variantError } = await supabase
        .from('variants')
        .upsert(upserts, { onConflict: 'item_id,size,color' });

      if (variantError) throw variantError;
    }

    return;
  }

  return await db.transaction('rw', db.items, db.variants, async () => {
    const itemId = Number(id);
    await db.items.update(itemId, {
      name: itemData.name,
      description: itemData.description || '',
      supplierName: itemData.supplierName,
      supplierContact: itemData.supplierContact,
      unitCost: Number(itemData.unitCost) || 0,
      wholesalePrice: Number(itemData.wholesalePrice) || 0,
      updatedAt: new Date().toISOString()
    });

    if (itemData.variants) {
      for (const v of itemData.variants) {
        const existing = await db.variants.where({ itemId, size: v.size, color: v.color }).first();
        if (existing) {
          await db.variants.update(existing.id, {
            stockQuantity: Math.max(0, Number(v.quantity) || 0)
          });
        } else {
          await db.variants.add({
            itemId,
            size: v.size,
            color: v.color,
            stockQuantity: Math.max(0, Number(v.quantity) || 0)
          });
        }
      }
    }
  });
}

export async function deleteDressItem(id) {
  const itemId = Number(id);

  if (isSupabaseConfigured()) {
    const { error: variantError } = await supabase.from('variants').delete().eq('item_id', itemId);
    if (variantError) throw variantError;

    const { error: itemError } = await supabase.from('items').delete().eq('id', itemId);
    if (itemError) throw itemError;
    return;
  }

  return await db.transaction('rw', db.items, db.variants, db.transactions, async () => {
    await db.variants.where({ itemId }).delete();
    await db.items.delete(itemId);
  });
}

export async function processStockIn(data) {
  if (isSupabaseConfigured()) {
    const itemId = Number(data.itemId);
    const { data: item, error: itemError } = await supabase.from('items').select('*').eq('id', itemId).single();
    if (itemError) throw itemError;
    if (!item) throw new Error('Dress item not found');

    const qty = Number(data.quantity);
    const unitCost = Number(data.unitCost);
    const timestamp = data.timestamp || new Date().toISOString();

    if (!Number.isNaN(unitCost) && unitCost > 0) {
      const { error: updateError } = await supabase.from('items').update({
        unit_cost: unitCost,
        supplier_name: data.supplierName || item.supplier_name,
        updated_at: new Date().toISOString(),
      }).eq('id', itemId);
      if (updateError) throw updateError;
    }

    const { data: variant } = await supabase
      .from('variants')
      .select('*')
      .eq('item_id', itemId)
      .eq('size', data.size)
      .eq('color', data.color)
      .maybeSingle();

    if (variant) {
      const nextQty = Number(variant.stock_quantity || 0) + qty;
      const { error: variantError } = await supabase.from('variants').update({ stock_quantity: nextQty }).eq('id', variant.id);
      if (variantError) throw variantError;
    } else {
      const { error: variantError } = await supabase.from('variants').insert([{ item_id: itemId, size: data.size, color: data.color, stock_quantity: qty }]);
      if (variantError) throw variantError;
    }

    const { error: transactionError } = await supabase.from('transactions').insert([{
      type: 'IN',
      transaction_time: timestamp,
      item_id: itemId,
      item_name: item.name,
      supplier_name: data.supplierName || item.supplier_name,
      size: data.size,
      color: data.color,
      quantity: qty,
      unit_cost: unitCost || Number(item.unit_cost || 0),
      wholesale_price: Number(item.wholesale_price || 0),
      reason_code: 'Stock Receiving',
      total_cost_amount: qty * (unitCost || Number(item.unit_cost || 0)),
      notes: data.notes || '',
    }]);

    if (transactionError) throw transactionError;
    return;
  }

  return await db.transaction('rw', db.items, db.variants, db.transactions, async () => {
    const itemId = Number(data.itemId);
    const item = await db.items.get(itemId);
    if (!item) throw new Error('Dress item not found');

    const qty = Number(data.quantity);
    const unitCost = Number(data.unitCost);
    const timestamp = data.timestamp || new Date().toISOString();

    if (!isNaN(unitCost) && unitCost > 0) {
      await db.items.update(itemId, {
        unitCost: unitCost,
        supplierName: data.supplierName || item.supplierName,
        updatedAt: new Date().toISOString()
      });
    }

    const variant = await db.variants.where({ itemId, size: data.size, color: data.color }).first();

    if (variant) {
      await db.variants.update(variant.id, {
        stockQuantity: (variant.stockQuantity || 0) + qty
      });
    } else {
      await db.variants.add({
        itemId,
        size: data.size,
        color: data.color,
        stockQuantity: qty
      });
    }

    await db.transactions.add({
      type: 'IN',
      timestamp,
      itemId,
      itemName: item.name,
      supplierName: data.supplierName || item.supplierName,
      size: data.size,
      color: data.color,
      quantity: qty,
      unitCost: unitCost || item.unitCost,
      wholesalePrice: item.wholesalePrice,
      reasonCode: 'Stock Receiving',
      totalCostAmount: qty * (unitCost || item.unitCost),
      notes: data.notes || ''
    });
  });
}

export async function processStockOut(data) {
  if (isSupabaseConfigured()) {
    const itemId = Number(data.itemId);
    const { data: item, error: itemError } = await supabase.from('items').select('*').eq('id', itemId).single();
    if (itemError) throw itemError;
    if (!item) throw new Error('Dress item not found');

    const qty = Number(data.quantity);
    const timestamp = data.timestamp || new Date().toISOString();

    const { data: variant } = await supabase
      .from('variants')
      .select('*')
      .eq('item_id', itemId)
      .eq('size', data.size)
      .eq('color', data.color)
      .maybeSingle();

    if (!variant || Number(variant.stock_quantity || 0) < qty) {
      const currentQty = variant ? Number(variant.stock_quantity || 0) : 0;
      throw new Error(`Insufficient stock for ${item.name} (${data.size} / ${data.color}). Available: ${currentQty} pieces, Requested: ${qty} pieces.`);
    }

    const nextQty = Number(variant.stock_quantity || 0) - qty;
    const { error: updateError } = await supabase.from('variants').update({ stock_quantity: nextQty }).eq('id', variant.id);
    if (updateError) throw updateError;

    const totalWholesaleValue = qty * Number(item.wholesale_price || 0);
    const totalCostValue = qty * Number(item.unit_cost || 0);

    const { error: transactionError } = await supabase.from('transactions').insert([{
      type: 'OUT',
      transaction_time: timestamp,
      item_id: itemId,
      item_name: item.name,
      customer_name: data.customerName || 'N/A',
      reference_no: data.referenceNo || 'N/A',
      size: data.size,
      color: data.color,
      quantity: qty,
      unit_cost: Number(item.unit_cost || 0),
      wholesale_price: Number(item.wholesale_price || 0),
      reason_code: data.reasonCode || 'Wholesale Customer Sale',
      total_wholesale_amount: totalWholesaleValue,
      total_cost_amount: totalCostValue,
      notes: data.notes || '',
    }]);

    if (transactionError) throw transactionError;
    return;
  }

  return await db.transaction('rw', db.items, db.variants, db.transactions, async () => {
    const itemId = Number(data.itemId);
    const item = await db.items.get(itemId);
    if (!item) throw new Error('Dress item not found');

    const qty = Number(data.quantity);
    const timestamp = data.timestamp || new Date().toISOString();

    const variant = await db.variants.where({ itemId, size: data.size, color: data.color }).first();

    if (!variant || (variant.stockQuantity || 0) < qty) {
      const currentQty = variant ? variant.stockQuantity : 0;
      throw new Error(`Insufficient stock for ${item.name} (${data.size} / ${data.color}). Available: ${currentQty} pieces, Requested: ${qty} pieces.`);
    }

    await db.variants.update(variant.id, { stockQuantity: variant.stockQuantity - qty });

    const totalWholesaleValue = qty * item.wholesalePrice;
    const totalCostValue = qty * item.unitCost;

    await db.transactions.add({
      type: 'OUT',
      timestamp,
      itemId,
      itemName: item.name,
      customerName: data.customerName || 'N/A',
      referenceNo: data.referenceNo || 'N/A',
      size: data.size,
      color: data.color,
      quantity: qty,
      unitCost: item.unitCost,
      wholesalePrice: item.wholesalePrice,
      reasonCode: data.reasonCode || 'Wholesale Customer Sale',
      totalWholesaleAmount: totalWholesaleValue,
      totalCostAmount: totalCostValue,
      notes: data.notes || ''
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
  const variants = items.flatMap(item => (item.variants || []).map(v => ({ ...v, itemId: item.id })));

  const payload = {
    appName: 'DressStock Shop',
    appVersion: '1.0.0',
    exportDate: new Date().toISOString(),
    deviceName: options.deviceName || 'Unknown Device',
    data: { items: items.map(item => ({
      id: item.id,
      name: item.name,
      description: item.description || '',
      supplierName: item.supplierName || 'General Supplier',
      supplierContact: item.supplierContact || '',
      unitCost: Number(item.unitCost || 0),
      wholesalePrice: Number(item.wholesalePrice || 0),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    })), variants, transactions }
  };

  return JSON.stringify(payload, null, 2);
}

export async function importDatabaseJSON(jsonString) {
  const data = JSON.parse(jsonString);
  const safeData = data.data || data;

  await db.transaction('rw', db.items, db.variants, db.transactions, async () => {
    await db.items.clear();
    await db.variants.clear();
    await db.transactions.clear();

    if (safeData.items) await db.items.bulkAdd(safeData.items);
    if (safeData.variants) await db.variants.bulkAdd(safeData.variants);
    if (safeData.transactions) await db.transactions.bulkAdd(safeData.transactions);
  });
}

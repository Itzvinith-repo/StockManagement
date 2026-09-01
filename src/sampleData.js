import { db } from './db.js';

export async function seedSampleData(forceReset = false) {
  const existingCount = await db.items.count();
  if (existingCount > 0 && !forceReset) {
    return; // Already populated
  }

  await db.transaction('rw', db.items, db.transactions, async () => {
    await db.items.clear();
    await db.transactions.clear();

    const sampleItems = [
      {
        name: 'Floral Silk Maxi Dress',
        description: 'Premium mulberry silk full-length maxi dress with floral print and tiered skirt.',
        supplierName: 'Elegance Fabrics & Couture',
        supplierContact: '+94 11 234-5678 | info@elegancefabrics.lk',
        quantity: 24,
        unitPrice: 4500.00,
        totalValue: 108000.00
      },
      {
        name: 'Velvet Evening Gown',
        description: 'Sophisticated off-shoulder velvet maxi gown featuring side slit and tailored fitting.',
        supplierName: 'Royal Garments Ltd.',
        supplierContact: '+94 11 876-5432 | orders@royalgarments.lk',
        quantity: 18,
        unitPrice: 6200.00,
        totalValue: 111600.00
      },
      {
        name: 'Boho Chiffon Sundress',
        description: 'Lightweight breathable chiffon summer dress with ruffled hem and drawstring waist.',
        supplierName: 'Sunrise Fashion House',
        supplierContact: '+94 11 432-1098 | sales@sunrisefashion.lk',
        quantity: 12,
        unitPrice: 2300.00,
        totalValue: 27600.00
      },
      {
        name: 'Classic Satin Bodycon Mini',
        description: 'Stretch satin bodycon mini dress with cowled neckline and adjustable spaghetti straps.',
        supplierName: 'Urban Trend Apparel',
        supplierContact: '+94 11 901-2345 | wholesale@urbantrend.lk',
        quantity: 40,
        unitPrice: 2800.00,
        totalValue: 112000.00
      },
      {
        name: 'Embroidered Linen Midi Dress',
        description: '100% pure organic linen midi dress with delicate hand-embroidered floral borders.',
        supplierName: 'Elegance Fabrics & Couture',
        supplierContact: '+94 11 234-5678 | info@elegancefabrics.lk',
        quantity: 15,
        unitPrice: 3700.00,
        totalValue: 55500.00
      }
    ];

    const now = new Date();
    
    for (const itemData of sampleItems) {
      const itemId = await db.items.add({
        name: itemData.name,
        description: itemData.description,
        supplierName: itemData.supplierName,
        supplierContact: itemData.supplierContact,
        quantity: itemData.quantity,
        unitPrice: itemData.unitPrice,
        totalValue: itemData.totalValue,
        createdAt: new Date(now - 86400000 * 15).toISOString(),
        updatedAt: now.toISOString()
      });

      // Add Stock-In initial log
      const initialInQty = itemData.quantity + 30;
      await db.transactions.add({
        type: 'IN',
        timestamp: new Date(now - 86400000 * 12).toISOString(),
        itemId,
        itemName: itemData.name,
        supplierName: itemData.supplierName,
        quantity: initialInQty,
        unitPrice: itemData.unitPrice,
        totalAmount: initialInQty * itemData.unitPrice,
        reasonCode: 'Stock Receiving',
        notes: 'Initial warehouse stocking lot'
      });

      // Add Stock-Out sales log
      const soldQty = 30;
      await db.transactions.add({
        type: 'OUT',
        timestamp: new Date(now - 86400000 * 3).toISOString(),
        itemId,
        itemName: itemData.name,
        customerName: 'Boutique Chic Retailers',
        referenceNo: `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        quantity: soldQty,
        unitPrice: itemData.unitPrice,
        totalAmount: soldQty * itemData.unitPrice,
        reasonCode: 'Wholesale Customer Sale',
        notes: 'Batch wholesale order for autumn collection'
      });
    }
  });
  console.log('Sample dress stock data seeded successfully.');
}

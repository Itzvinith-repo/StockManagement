import { db } from './db.js';

export async function seedSampleData(forceReset = false) {
  const existingCount = await db.items.count();
  if (existingCount > 0 && !forceReset) {
    return; // Already populated
  }

  await db.transaction('rw', db.items, db.variants, db.transactions, async () => {
    await db.items.clear();
    await db.variants.clear();
    await db.transactions.clear();

    const sampleItems = [
      {
        name: 'Floral Silk Maxi Dress',
        description: 'Premium mulberry silk full-length maxi dress with floral print and tiered skirt.',
        supplierName: 'Elegance Fabrics & Couture',
        supplierContact: '+94 11 234-5678 | info@elegancefabrics.lk',
        unitCost: 4500.00,
        wholesalePrice: 8500.00,
        variants: [
          { size: 'S', color: 'Floral Pink', quantity: 24 },
          { size: 'M', color: 'Floral Pink', quantity: 36 },
          { size: 'L', color: 'Floral Pink', quantity: 20 },
          { size: 'S', color: 'Emerald Green', quantity: 15 },
          { size: 'M', color: 'Emerald Green', quantity: 28 },
          { size: 'XL', color: 'Emerald Green', quantity: 10 }
        ]
      },
      {
        name: 'Velvet Evening Gown',
        description: 'Sophisticated off-shoulder velvet maxi gown featuring side slit and tailored fitting.',
        supplierName: 'Royal Garments Ltd.',
        supplierContact: '+94 11 876-5432 | orders@royalgarments.lk',
        unitCost: 6200.00,
        wholesalePrice: 12000.00,
        variants: [
          { size: 'S', color: 'Midnight Blue', quantity: 18 },
          { size: 'M', color: 'Midnight Blue', quantity: 30 },
          { size: 'L', color: 'Midnight Blue', quantity: 22 },
          { size: 'M', color: 'Ruby Red', quantity: 14 },
          { size: 'L', color: 'Ruby Red', quantity: 12 }
        ]
      },
      {
        name: 'Boho Chiffon Sundress',
        description: 'Lightweight breathable chiffon summer dress with ruffled hem and drawstring waist.',
        supplierName: 'Sunrise Fashion House',
        supplierContact: '+94 11 432-1098 | sales@sunrisefashion.lk',
        unitCost: 2300.00,
        wholesalePrice: 4500.00,
        variants: [
          { size: 'XS', color: 'Ivory White', quantity: 12 },
          { size: 'S', color: 'Ivory White', quantity: 45 },
          { size: 'M', color: 'Ivory White', quantity: 50 },
          { size: 'L', color: 'Ivory White', quantity: 30 },
          { size: 'S', color: 'Coral Sun', quantity: 25 },
          { size: 'M', color: 'Coral Sun', quantity: 35 }
        ]
      },
      {
        name: 'Classic Satin Bodycon Mini',
        description: 'Stretch satin bodycon mini dress with cowled neckline and adjustable spaghetti straps.',
        supplierName: 'Urban Trend Apparel',
        supplierContact: '+94 11 901-2345 | wholesale@urbantrend.lk',
        unitCost: 2800.00,
        wholesalePrice: 5500.00,
        variants: [
          { size: 'S', color: 'Champagne Gold', quantity: 40 },
          { size: 'M', color: 'Champagne Gold', quantity: 45 },
          { size: 'L', color: 'Champagne Gold', quantity: 18 },
          { size: 'S', color: 'Jet Black', quantity: 55 },
          { size: 'M', color: 'Jet Black', quantity: 60 },
          { size: 'L', color: 'Jet Black', quantity: 30 }
        ]
      },
      {
        name: 'Embroidered Linen Midi Dress',
        description: '100% pure organic linen midi dress with delicate hand-embroidered floral borders.',
        supplierName: 'Elegance Fabrics & Couture',
        supplierContact: '+94 11 234-5678 | info@elegancefabrics.lk',
        unitCost: 3700.00,
        wholesalePrice: 7200.00,
        variants: [
          { size: 'S', color: 'Sage Green', quantity: 15 },
          { size: 'M', color: 'Sage Green', quantity: 20 },
          { size: 'L', color: 'Sage Green', quantity: 10 },
          { size: 'Free Size', color: 'Natural Sand', quantity: 35 }
        ]
      }
    ];

    const now = new Date();
    
    for (const itemData of sampleItems) {
      const itemId = await db.items.add({
        name: itemData.name,
        description: itemData.description,
        supplierName: itemData.supplierName,
        supplierContact: itemData.supplierContact,
        unitCost: itemData.unitCost,
        wholesalePrice: itemData.wholesalePrice,
        createdAt: new Date(now - 86400000 * 15).toISOString(),
        updatedAt: now.toISOString()
      });

      let itemTotalQty = 0;
      for (const v of itemData.variants) {
        await db.variants.add({
          itemId,
          size: v.size,
          color: v.color,
          stockQuantity: v.quantity
        });
        itemTotalQty += v.quantity;
      }

      // Add Stock-In initial log
      const initialInQty = itemTotalQty + 30;
      await db.transactions.add({
        type: 'IN',
        timestamp: new Date(now - 86400000 * 12).toISOString(),
        itemId,
        itemName: itemData.name,
        supplierName: itemData.supplierName,
        size: itemData.variants[0].size,
        color: itemData.variants[0].color,
        quantity: initialInQty,
        unitCost: itemData.unitCost,
        wholesalePrice: itemData.wholesalePrice,
        reasonCode: 'Stock Receiving',
        totalCostAmount: initialInQty * itemData.unitCost,
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
        size: itemData.variants[0].size,
        color: itemData.variants[0].color,
        quantity: soldQty,
        unitCost: itemData.unitCost,
        wholesalePrice: itemData.wholesalePrice,
        reasonCode: 'Wholesale Customer Sale',
        totalWholesaleAmount: soldQty * itemData.wholesalePrice,
        totalCostAmount: soldQty * itemData.unitCost,
        notes: 'Batch wholesale order for autumn collection'
      });
    }
  });
  console.log('Sample dress stock data seeded successfully.');
}

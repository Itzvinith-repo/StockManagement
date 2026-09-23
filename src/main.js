import { createIcons, icons } from 'lucide';
import Chart from 'chart.js/auto';
import Papa from 'papaparse';
import { 
  db, 
  getAllItems, 
  getAllVendors,
  addVendor,
  updateVendor,
  deleteVendor,
  getItemById, 
  addDressItem, 
  updateDressItem, 
  deleteDressItem, 
  processStockIn, 
  processStockOut, 
  processStockOutMulti, 
  getAllTransactions,
  deleteTransaction,
  updateTransactionSupplierAndDate,
  clearAllTransactions,
  recordStockCorrection,
  getSupplierDailyStockInSummary,
  exportDatabaseJSON, 
  importDatabaseJSON,
  migrateSupabaseDataToLocal
} from './db.js';
import { computeProfitSummary } from './profitAnalyzer.js';

const APP_NAME = 'Farook Textiles Inventory Manager';
const APP_VERSION = '1.0.0';
const RECEIPT_SHOP_NAME = 'Farook Textiles';
const RECEIPT_WIDTH_MM = 80;

const stockInPrintSubmitController = {
  processing: false,
  async run({ printFn, submitFn }) {
    if (this.processing) {
      return { ok: false, duplicate: true, message: 'Stock-In processing is already in progress.' };
    }

    this.processing = true;

    try {
      await printFn();
      await submitFn();
      return { ok: true, duplicate: false, message: 'Stock-In submitted successfully.' };
    } catch (error) {
      return { ok: false, duplicate: false, message: error?.message || 'Printing or submission failed.' };
    } finally {
      this.processing = false;
    }
  },
};

const stockOutPrintSubmitController = {
  processing: false,
  async run({ printFn, submitFn }) {
    if (this.processing) {
      return { ok: false, duplicate: true, message: 'Stock-Out processing is already in progress.' };
    }

    this.processing = true;

    try {
      await printFn();
      await submitFn();
      return { ok: true, duplicate: false, message: 'Stock-Out submitted successfully.' };
    } catch (error) {
      return { ok: false, duplicate: false, message: error?.message || 'Printing or submission failed.' };
    } finally {
      this.processing = false;
    }
  },
};

// Charts instances
let stockDistChart = null;
let movementChart = null;
let profitChart = null;

// Application State
let currentTab = 'dashboard-tab';
let allItemsCache = [];
let allTransactionsCache = [];
let allVendorsCache = [];
let pendingStockInItemId = null;
let editingVendor = null;
let currentInvoicePreview = null;
let currentSupplierSummaryInvoice = null;

function updateProjectBadge() {
  // Branding badge intentionally removed for client-facing production use.
}

// Initialize Lucide icons
function refreshIcons() {
  createIcons({ icons });
}

// Utility formatting
function formatCurrency(val) {
  return 'Rs. ' + new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getLocalDatetimeString(date = new Date()) {
  const tzOffset = date.getTimezoneOffset() * 60000;
  const localISOTime = (new Date(date.getTime() - tzOffset)).toISOString().slice(0, 16);
  return localISOTime;
}

function renderStockInItemOptions(selectEl) {
  if (!selectEl) return;
  const items = allItemsCache.length
    ? allItemsCache.map(item => `<option value="${item.id}">${escapeHtml(item.name)} (${Number(item.quantity || 0)} pcs)</option>`).join('')
    : '<option value="">-- No items available --</option>';

  selectEl.innerHTML = `<option value="">-- Choose Item --</option>${items}`;
}

function updateStockInEntryRowTotal(rowEl) {
  const qtyInput = rowEl.querySelector('.stock-in-entry-qty');
  const unitPriceInput = rowEl.querySelector('.stock-in-entry-unit-price');
  const totalInput = rowEl.querySelector('.stock-in-entry-total');
  if (!qtyInput || !unitPriceInput || !totalInput) return;

  const qty = Number(qtyInput.value) || 0;
  const unitPrice = Number(unitPriceInput.value) || 0;
  totalInput.value = (qty * unitPrice).toFixed(2);
}

function updateStockInGrandTotal() {
  const totalInput = document.getElementById('stock-in-grand-total');
  if (!totalInput) return;

  const rows = document.querySelectorAll('.stock-in-entry-row');
  const total = [...rows].reduce((sum, row) => {
    const totalValue = Number(row.querySelector('.stock-in-entry-total')?.value || 0);
    return sum + totalValue;
  }, 0);

  totalInput.value = total.toFixed(2);
}

function addStockInEntryRow() {
  const container = document.getElementById('stock-in-items-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'stock-in-entry-row';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = 'minmax(180px, 2fr) minmax(80px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr) auto';
  row.style.gap = '10px';
  row.style.alignItems = 'end';
  row.innerHTML = `
    <div class="form-group" style="margin: 0;">
      <label style="display:block; margin-bottom:6px;">Item</label>
      <select class="form-control form-control-simple stock-in-entry-item" required>
        <option value="">-- Choose Item --</option>
      </select>
    </div>
    <div class="form-group" style="margin: 0;">
      <label style="display:block; margin-bottom:6px;">Qty</label>
      <input type="number" min="1" class="form-control form-control-simple stock-in-entry-qty" value="1" required>
    </div>
    <div class="form-group" style="margin: 0;">
      <label style="display:block; margin-bottom:6px;">Unit Price</label>
      <input type="number" step="0.01" min="0" class="form-control form-control-simple stock-in-entry-unit-price" value="0" required>
    </div>
    <div class="form-group" style="margin: 0;">
      <label style="display:block; margin-bottom:6px;">Line Total</label>
      <input type="number" step="0.01" class="form-control form-control-simple stock-in-entry-total" readonly value="0.00">
    </div>
    <button type="button" class="btn btn-secondary stock-in-entry-remove" style="align-self:end;">Remove</button>
  `;

  const itemSelect = row.querySelector('.stock-in-entry-item');
  const qtyInput = row.querySelector('.stock-in-entry-qty');
  const unitInput = row.querySelector('.stock-in-entry-unit-price');

  renderStockInItemOptions(itemSelect);

  itemSelect.addEventListener('change', () => {
    const selectedId = itemSelect.value;
    const item = allItemsCache.find(entry => Number(entry.id) === Number(selectedId));
    if (item) {
      const price = Number(item.unitPrice || 0);
      unitInput.value = price.toFixed(2);
      if (!qtyInput.value || Number(qtyInput.value) < 1) qtyInput.value = 1;
    }
    updateStockInEntryRowTotal(row);
    updateStockInGrandTotal();
  });

  qtyInput.addEventListener('input', () => {
    updateStockInEntryRowTotal(row);
    updateStockInGrandTotal();
  });

  unitInput.addEventListener('input', () => {
    updateStockInEntryRowTotal(row);
    updateStockInGrandTotal();
  });

  row.querySelector('.stock-in-entry-remove').addEventListener('click', () => {
    row.remove();
    updateStockInGrandTotal();
  });

  container.appendChild(row);
  updateStockInGrandTotal();
}

function getStockInEntryRows() {
  return [...document.querySelectorAll('.stock-in-entry-row')];
}

function renderStockOutItemOptions(selectEl) {
  if (!selectEl) return;
  const items = allItemsCache.length
    ? allItemsCache.map(item => {
        const stockQty = Number(item.quantity || 0);
        return `<option value="${item.id}" data-stock="${stockQty}" data-price="${Number(item.unitPrice || 0)}">${escapeHtml(item.name)} (${stockQty} pcs available)</option>`;
      }).join('')
    : '<option value="">-- No items available --</option>';

  selectEl.innerHTML = `<option value="">-- Choose Item --</option>${items}`;
}

function updateStockOutEntryRowTotal(rowEl) {
  const qtyInput = rowEl.querySelector('.stock-out-entry-qty');
  const unitPriceInput = rowEl.querySelector('.stock-out-entry-unit-price');
  const totalInput = rowEl.querySelector('.stock-out-entry-total');
  const stockSpan = rowEl.querySelector('.stock-out-entry-available');
  if (!qtyInput || !unitPriceInput || !totalInput) return;

  const qty = Number(qtyInput.value) || 0;
  const unitPrice = Number(unitPriceInput.value) || 0;
  totalInput.value = (qty * unitPrice).toFixed(2);
  
  if (stockSpan) {
    const available = Number(stockSpan.dataset.stock || 0);
    stockSpan.textContent = `Available: ${available} pcs`;
    stockSpan.style.color = qty > available ? 'var(--accent-danger)' : 'var(--text-muted)';
  }
}

function updateStockOutGrandTotal() {
  const totalInput = document.getElementById('stock-out-grand-total');
  if (!totalInput) return;

  const rows = document.querySelectorAll('.stock-out-entry-row');
  const total = [...rows].reduce((sum, row) => {
    const totalValue = Number(row.querySelector('.stock-out-entry-total')?.value || 0);
    return sum + totalValue;
  }, 0);

  totalInput.value = total.toFixed(2);
}

function addStockOutEntryRow() {
  const container = document.getElementById('stock-out-items-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'stock-out-entry-row';
  row.style.display = 'flex';
  row.style.flexWrap = 'wrap';
  row.style.gap = '12px';
  row.style.alignItems = 'flex-end';
  row.style.padding = '12px';
  row.style.border = '1px solid rgba(128, 128, 128, 0.25)';
  row.style.borderRadius = '8px';
  row.style.background = 'rgba(128, 128, 128, 0.05)';
  row.innerHTML = `
    <div class="form-group" style="margin: 0; flex: 2 1 220px; min-width: 180px;">
      <label style="display:block; margin-bottom:6px;">Item</label>
      <select class="form-control form-control-simple stock-out-entry-item" required>
        <option value="">-- Choose Item --</option>
      </select>
    </div>
    <div class="form-group" style="margin: 0; flex: 0 1 80px; min-width: 72px;">
      <label style="display:block; margin-bottom:6px;">Qty</label>
      <input type="number" min="1" class="form-control form-control-simple stock-out-entry-qty" value="1" required>
    </div>
    <div class="form-group" style="margin: 0; flex: 1 1 130px; min-width: 110px;">
      <label style="display:block; margin-bottom:6px;">Unit Price (LKR)</label>
      <input type="number" step="0.01" min="0" class="form-control form-control-simple stock-out-entry-unit-price" value="0" required>
    </div>
    <div class="form-group" style="margin: 0; flex: 1 1 120px; min-width: 100px;">
      <label style="display:block; margin-bottom:6px;">Line Total (LKR)</label>
      <input type="number" step="0.01" class="form-control form-control-simple stock-out-entry-total" readonly value="0.00">
    </div>
    <div class="form-group" style="margin: 0; flex: 1 1 110px; min-width: 90px;">
      <label style="display:block; margin-bottom:6px;">&nbsp;</label>
      <span class="stock-out-entry-available" style="font-size: 0.75rem; color: var(--text-muted); line-height: 38px;" data-stock="0">Available: 0 pcs</span>
    </div>
    <button type="button" class="btn btn-secondary stock-out-entry-remove" style="flex: 0 0 auto; margin-left: auto; margin-bottom: 1px;">
      Remove
    </button>
  `;

  const itemSelect = row.querySelector('.stock-out-entry-item');
  const qtyInput = row.querySelector('.stock-out-entry-qty');
  const unitInput = row.querySelector('.stock-out-entry-unit-price');
  const stockSpan = row.querySelector('.stock-out-entry-available');

  renderStockOutItemOptions(itemSelect);

  itemSelect.addEventListener('change', () => {
    const selectedId = itemSelect.value;
    const item = allItemsCache.find(entry => Number(entry.id) === Number(selectedId));
    if (item) {
      const price = Number(item.unitPrice || 0);
      unitInput.value = price.toFixed(2);
      if (!qtyInput.value || Number(qtyInput.value) < 1) qtyInput.value = 1;
      stockSpan.dataset.stock = Number(item.quantity || 0);
    } else {
      stockSpan.dataset.stock = 0;
    }
    updateStockOutEntryRowTotal(row);
    updateStockOutGrandTotal();
  });

  qtyInput.addEventListener('input', () => {
    updateStockOutEntryRowTotal(row);
    updateStockOutGrandTotal();
  });

  unitInput.addEventListener('input', () => {
    updateStockOutEntryRowTotal(row);
    updateStockOutGrandTotal();
  });

  row.querySelector('.stock-out-entry-remove').addEventListener('click', () => {
    row.remove();
    updateStockOutGrandTotal();
  });

  container.appendChild(row);
  updateStockOutGrandTotal();
}

function getStockOutEntryRows() {
  return [...document.querySelectorAll('.stock-out-entry-row')];
}

function createStockInInvoicePreview({ supplierName, invoiceNo, notes, timestamp, rows }) {
  const items = rows.map(row => {
    const itemSelect = row.querySelector('.stock-in-entry-item');
    const qtyInput = row.querySelector('.stock-in-entry-qty');
    const unitInput = row.querySelector('.stock-in-entry-unit-price');
    const item = allItemsCache.find(entry => Number(entry.id) === Number(itemSelect.value));
    const quantity = Number(qtyInput.value) || 0;
    const unitPrice = Number(unitInput.value) || Number(item?.unitPrice || 0);
    const totalAmount = quantity * unitPrice;

    return {
      itemId: Number(itemSelect.value),
      itemName: item?.name || 'Dress Item',
      supplierName,
      quantity,
      unitPrice,
      totalAmount,
      referenceNo: invoiceNo || 'N/A',
      reasonCode: 'Stock Receiving',
      notes: notes || '',
      description: item?.description || '',
      timestamp,
    };
  }).filter(entry => entry.itemId && entry.quantity > 0 && entry.unitPrice >= 0);

  if (!items.length) return null;

  const totalAmount = items.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
  return {
    id: Date.now(),
    type: 'IN',
    supplierName,
    customerName: '',
    quantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    totalAmount,
    referenceNo: invoiceNo || 'N/A',
    reasonCode: 'Stock Receiving',
    notes: notes || 'Stock receipt',
    description: 'Multiple items received into stock',
    timestamp,
    itemName: items[0]?.itemName || 'Dress Item',
    items,
  };
}

function createStockOutInvoicePreview({ supplierName, customerName, invoiceNo, notes, reasonCode, timestamp, rows }) {
  const items = rows.map(row => {
    const itemSelect = row.querySelector('.stock-out-entry-item');
    const qtyInput = row.querySelector('.stock-out-entry-qty');
    const unitInput = row.querySelector('.stock-out-entry-unit-price');
    const item = allItemsCache.find(entry => Number(entry.id) === Number(itemSelect.value));
    const quantity = Number(qtyInput.value) || 0;
    const unitPrice = Number(unitInput.value) || Number(item?.unitPrice || 0);
    const totalAmount = quantity * unitPrice;

    return {
      itemId: Number(itemSelect.value),
      itemName: item?.name || 'Dress Item',
      supplierName,
      customerName,
      quantity,
      unitPrice,
      totalAmount,
      referenceNo: invoiceNo || 'N/A',
      reasonCode: reasonCode || 'Wholesale Customer Sale',
      notes: notes || '',
      description: item?.description || '',
      timestamp,
    };
  }).filter(entry => entry.itemId && entry.quantity > 0 && entry.unitPrice >= 0);

  if (!items.length) return null;

  const totalAmount = items.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
  return {
    id: Date.now(),
    type: 'OUT',
    supplierName,
    customerName,
    quantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    totalAmount,
    referenceNo: invoiceNo || 'N/A',
    reasonCode: reasonCode || 'Wholesale Customer Sale',
    notes: notes || 'Stock dispatch',
    description: 'Multiple items dispatched from stock',
    timestamp,
    itemName: items[0]?.itemName || 'Dress Item',
    items,
  };
}

// Global App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  try {
    if ('storage' in navigator && 'persist' in navigator.storage) {
      navigator.storage.persist().catch(() => {});
    }

    // Client-ready app: do not auto-seed demo inventory data.
    // Users can import a backup or start adding live stock data from scratch.
    await migrateSupabaseDataToLocal();

    // 1. Attach navigation event listeners
    initNavigation();

    // 3. Attach Theme Toggle
    initTheme();

    // 4. Attach Modal & Form handlers
    initModalHandlers();
    initVendorHandlers();
    initStockInForm();
    initStockOutForm();
    initProfitAnalyzerHandlers();
    initReportsHandlers();
    initDataBackupHandlers();

    // 5. Load initial dataset & render active view
    await refreshAllData();

    // 6. Attach catalog action delegation ONCE on the stable table wrapper
    initCatalogDelegation();

    refreshIcons();
  } catch (err) {
    console.error('Initialization error:', err);
  }
});

// Theme Toggle
function initTheme() {
  const btn = document.getElementById('theme-toggle-btn');
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');

  btn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    
    if (newTheme === 'dark') {
      label.textContent = 'Dark Theme';
      icon.setAttribute('data-lucide', 'moon');
    } else {
      label.textContent = 'Light Theme';
      icon.setAttribute('data-lucide', 'sun');
    }
    refreshIcons();
    if (stockDistChart) renderCharts();
  });
}

// Navigation Tabs Handling
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const mobileToggle = document.getElementById('mobile-nav-toggle');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  mobileToggle.addEventListener('click', () => {
    const isOpen = sidebar.classList.toggle('open');
    backdrop.classList.toggle('active', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  });

  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('active');
    document.body.style.overflow = '';
  });

  navBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.getAttribute('data-tab');
      if (!tabId) return;

      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
      const activePane = document.getElementById(tabId);
      if (activePane) activePane.classList.add('active');

      currentTab = tabId;

      // Update Header Title & Description
      updateHeaderTitle(tabId);

      // Refresh only the active tab's view (caches are already up to date)
      renderActiveView();

      if (tabId === 'stock-in-tab' && pendingStockInItemId !== null) {
        prefillStockInForm(pendingStockInItemId);
        pendingStockInItemId = null;
      }

      // Close mobile drawer on item select
      sidebar.classList.remove('open');
      backdrop.classList.remove('active');
      document.body.style.overflow = '';
    });
  });

  // Quick Action Buttons in Top Bar
  document.getElementById('quick-stock-in-btn').addEventListener('click', () => {
    document.getElementById('nav-stock-in').click();
  });
  document.getElementById('quick-stock-out-btn').addEventListener('click', () => {
    document.getElementById('nav-stock-out').click();
  });
  document.getElementById('view-all-logs-btn').addEventListener('click', () => {
    document.getElementById('nav-reports').click();
    document.getElementById('rpt-nav-movement').click();
  });
}

function updateHeaderTitle(tabId) {
  const titleEl = document.getElementById('current-page-title');
  const descEl = document.getElementById('current-page-desc');

  const titles = {
    'dashboard-tab': { title: 'Dashboard Overview', desc: 'Real-time stock status, inventory valuation, and recent activity.' },
    'catalog-tab': { title: 'Dress Catalog & Master Profiles', desc: 'Manage dress items, supplier information, unit pricing, and stock totals.' },
    'vendor-tab': { title: 'Vendor Catalog', desc: 'Maintain the supplier directory used throughout inventory workflows.' },
    'stock-in-tab': { title: 'Stock-In Management (Receiving Goods)', desc: 'Record incoming dress shipments, update unit purchase prices, and auto-update inventory.' },
    'stock-out-tab': { title: 'Stock-Out Management (Sales & Reductions)', desc: 'Log sales, damaged garments, or vendor returns with reference numbers and reason codes.' },
    'invoices-tab': { title: 'Invoice Center', desc: 'View, print, and download all transaction and supplier summary invoices.' },
    'reports-tab': { title: 'Reports & Analytics Dashboard', desc: 'Real-time stock levels, transaction audit movement logs, and total inventory valuation.' },
    'settings-tab': { title: 'Offline Storage & Data Backup', desc: 'Export or restore complete JSON database backup for client-side offline storage.' }
  };

  if (titles[tabId]) {
    titleEl.textContent = titles[tabId].title;
    descEl.textContent = titles[tabId].desc;
  }
}

// Master Refresh Data Engine
export async function refreshAllData() {
  const [items, transactions] = await Promise.all([
    getAllItems(),
    getAllTransactions(),
  ]);
  const vendors = await getAllVendors({ items, transactions });
  allItemsCache = items;
  allTransactionsCache = transactions;
  allVendorsCache = vendors;

  renderAll();
  refreshIcons();
}

function renderAll() {
  populateItemDropdowns();
  renderDashboard();
  renderCatalogTable();
  renderVendorCatalog();
  renderReports();
}

// Render only the tab currently visible. Caches are already loaded, so no
// re-fetching or re-rendering of hidden views.
function renderActiveView() {
  switch (currentTab) {
    case 'dashboard-tab':
      renderDashboard();
      break;
    case 'catalog-tab':
      populateItemDropdowns();
      renderCatalogTable();
      break;
    case 'vendor-tab':
      populateItemDropdowns();
      renderVendorCatalog();
      break;
    case 'stock-in-tab':
    case 'stock-out-tab':
      populateItemDropdowns();
      break;
    case 'invoices-tab':
      renderInvoiceList();
      if (currentInvoicePreview) renderInvoiceDetail(currentInvoicePreview);
      break;
    case 'reports-tab':
      renderReports();
      break;
    case 'settings-tab':
    default:
      break;
  }
  refreshIcons();
}

// Populate Item select boxes for Stock-In & Stock-Out
function populateItemDropdowns() {
  const stockInSelect = document.getElementById('stock-in-item');
  const supplierFilter = document.getElementById('catalog-supplier-filter');
  const dressSupplierSelect = document.getElementById('dress-supplier-name');
  const stockInSupplierSelect = document.getElementById('stock-in-supplier');
  const stockOutSupplierSelect = document.getElementById('stock-out-supplier');

  const prevInVal = stockInSelect ? stockInSelect.value : '';

  if (stockInSelect) {
    stockInSelect.innerHTML = '<option value="">-- Choose Item --</option>';
  }

  const suppliers = new Set(allVendorsCache.map(vendor => vendor.name));

  document.querySelectorAll('.stock-in-entry-item').forEach(select => {
    const currentValue = select.value;
    renderStockInItemOptions(select);
    if (currentValue) select.value = currentValue;
  });

  document.querySelectorAll('.stock-out-entry-item').forEach(select => {
    const currentValue = select.value;
    renderStockOutItemOptions(select);
    if (currentValue) {
      select.value = currentValue;
      const item = allItemsCache.find(entry => Number(entry.id) === Number(currentValue));
      const stockSpan = select.closest('.stock-out-entry-row')?.querySelector('.stock-out-entry-available');
      if (stockSpan) {
        stockSpan.dataset.stock = Number(item?.quantity || 0);
        stockSpan.textContent = `Available: ${Number(item?.quantity || 0)} pcs`;
      }
    }
  });

  allItemsCache.forEach(item => {
    const stockQty = Number(item.quantity || 0);
    const optIn = document.createElement('option');
    optIn.value = item.id;
    optIn.textContent = `${item.name} (${stockQty} pcs in stock)`;
    stockInSelect && stockInSelect.appendChild(optIn);

    if (item.supplierName) suppliers.add(item.supplierName);
  });

  if (prevInVal && stockInSelect) stockInSelect.value = prevInVal;

  // Supplier filter options
  if (supplierFilter) {
    supplierFilter.innerHTML = '<option value="">All Suppliers</option>';
    suppliers.forEach(sup => {
      const opt = document.createElement('option');
      opt.value = sup;
      opt.textContent = sup;
      supplierFilter.appendChild(opt);
    });
  }

  [dressSupplierSelect, stockInSupplierSelect, stockOutSupplierSelect].forEach(select => {
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = '<option value="">-- Choose Vendor --</option>';
    [...suppliers].sort((a, b) => a.localeCompare(b)).forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    if (previousValue) select.value = previousValue;
  });

}

// Render Dashboard Metrics & Charts
function renderDashboard() {
  let totalItemsCount = allItemsCache.length;
  let totalPiecesCount = 0;
  let totalCostValuation = 0;
  let totalWholesaleValuation = 0;

  allItemsCache.forEach(item => {
    const itemPieces = Number(item.quantity || 0);
    totalPiecesCount += itemPieces;
    const unitPrice = Number(item.unitPrice || 0);
    totalCostValuation += itemPieces * unitPrice;
    totalWholesaleValuation += itemPieces * unitPrice;
  });

  document.getElementById('dash-total-items').textContent = totalItemsCount;
  document.getElementById('dash-total-pieces').textContent = totalPiecesCount.toLocaleString();
  document.getElementById('dash-total-cost-val').textContent = formatCurrency(totalCostValuation);
  document.getElementById('dash-total-wholesale-val').textContent = formatCurrency(totalWholesaleValuation);

  // Recent logs table (top 5)
  const tbody = document.getElementById('dash-recent-logs-tbody');
  tbody.innerHTML = '';

  const recentTxs = allTransactionsCache.slice(0, 5);
  if (recentTxs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim);">No transactions logged yet.</td></tr>';
  } else {
    recentTxs.forEach(tx => {
      const tr = document.createElement('tr');
      const badgeClass = tx.type === 'IN' ? 'badge-in' : 'badge-out';
      const badgeText = tx.type === 'IN' ? 'Stock-In' : 'Stock-Out';
      const party = tx.type === 'IN' ? (tx.supplierName || 'Supplier') : (tx.customerName || 'Customer');
      const ref = tx.referenceNo && tx.referenceNo !== 'N/A' ? ` (${tx.referenceNo})` : '';

      tr.innerHTML = `
        <td style="font-size: 0.825rem; color: var(--text-muted);">${formatDate(tx.timestamp)}</td>
        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
        <td style="font-weight: 600;">${tx.itemName || 'Dress Item'}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${tx.description || tx.notes || (tx.type === 'IN' ? 'Stock receiving' : 'Sales / reduction')}</td>
        <td style="font-weight: 700;">${tx.type === 'IN' ? '+' : '-'}${tx.quantity} pcs</td>
        <td style="font-size: 0.85rem;">${party}${ref}</td>
        <td style="font-size: 0.85rem; color: var(--text-muted);">${tx.reasonCode || ''}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderCharts();
}

// Render Chart.js visual analytics
function renderCharts() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';

  // Chart 1: Stock Distribution Doughnut
  const distCanvas = document.getElementById('chart-stock-dist');
  if (distCanvas) {
    if (stockDistChart) stockDistChart.destroy();
    
    const labels = allItemsCache.map(i => i.name);
    const data = allItemsCache.map(i => Number(i.quantity || 0));
    const colors = [
      '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', 
      '#8b5cf6', '#f43f5e', '#14b8a6', '#eab308', '#3b82f6'
    ];

    stockDistChart = new Chart(distCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors.slice(0, labels.length),
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
          }
        }
      }
    });
  }

  // Chart 2: Recent Movement Bar Chart
  const moveCanvas = document.getElementById('chart-movement');
  if (moveCanvas) {
    if (movementChart) movementChart.destroy();

    // Group last 7 transactions by type
    let inQty = 0;
    let outQty = 0;
    allTransactionsCache.forEach(tx => {
      if (tx.type === 'IN') inQty += tx.quantity;
      if (tx.type === 'OUT') outQty += tx.quantity;
    });

    movementChart = new Chart(moveCanvas, {
      type: 'bar',
      data: {
        labels: ['Total Received (Stock-In)', 'Total Dispatched (Stock-Out)'],
        datasets: [{
          label: 'Quantity (Pieces)',
          data: [inQty, outQty],
          backgroundColor: ['#10b981', '#ef4444'],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: textColor }, grid: { display: false } },
          y: { ticks: { color: textColor }, grid: { color: gridColor } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }
}

function renderProfitChart(summary) {
  const canvas = document.getElementById('chart-profit-trend');
  if (!canvas) return;
  if (profitChart) profitChart.destroy();

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';

  const sorted = [...summary].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map(row => row.date);
  const profitData = sorted.map(row => row.profit);
  const stockInData = sorted.map(row => row.stockInCost);

  if (!labels.length) {
    return;
  }

  profitChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Profit (Stock-Out Amount)',
          data: profitData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 3
        },
        {
          label: 'Stock-In Cost',
          data: stockInData,
          borderColor: '#6366f1',
          backgroundColor: 'transparent',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: textColor, maxRotation: 45, font: { size: 10 } }, grid: { display: false } },
        y: {
          ticks: { color: textColor, callback: value => 'Rs. ' + Number(value).toLocaleString() },
          grid: { color: gridColor }
        }
      },
      plugins: {
        legend: { labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11 } } },
        tooltip: {
          callbacks: {
            label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`
          }
        }
      }
    }
  });
}

function getProfitPeriodDates() {
  const fromEl = document.getElementById('profit-date-from');
  const toEl = document.getElementById('profit-date-to');
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  const fromDate = fromEl && fromEl.value ? fromEl.value : new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const toDate = toEl && toEl.value ? toEl.value : localDate;

  if (fromEl && !fromEl.value) fromEl.value = fromDate;
  if (toEl && !toEl.value) toEl.value = toDate;

  return { fromDate, toDate };
}

function renderProfitAnalyzer() {
  const { fromDate, toDate } = getProfitPeriodDates();

  const { rows: summary, today, totalStockValue, todayStr } = computeProfitSummary({
    transactions: allTransactionsCache,
    items: allItemsCache,
    fromDate,
    toDate,
  });

  document.getElementById('profit-today-stockin-cost').textContent = formatCurrency(today.stockInCost);
  document.getElementById('profit-today-stockout-sales').textContent = formatCurrency(today.stockOutSales);
  document.getElementById('profit-today-profit').textContent = formatCurrency(today.profit);

  const profitEl = document.getElementById('profit-today-profit');
  profitEl.style.color = today.profit < 0 ? 'var(--accent-danger)' : 'var(--accent-success)';

  document.getElementById('profit-total-stock-value').textContent = formatCurrency(totalStockValue);
  document.getElementById('profit-stockin-count').textContent = today.stockInCount;
  document.getElementById('profit-stockout-count').textContent = today.stockOutCount;

  // History table
  const tbody = document.getElementById('profit-history-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!summary.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim);">No transactions in the selected date range.</td></tr>';
  } else {
    summary.forEach(day => {
      const tr = document.createElement('tr');
      const isToday = day.date === todayStr;
      tr.innerHTML = `
        <td style="font-weight: 600;">${isToday ? day.date + ' (Today)' : day.date}</td>
        <td>${formatCurrency(day.stockInCost)}</td>
        <td>${formatCurrency(day.stockOutSales)}</td>
        <td style="font-weight: 700; ${day.profit < 0 ? 'color: var(--accent-danger);' : 'color: var(--accent-success);'}">${formatCurrency(day.profit)}</td>
        <td>${day.stockInCount}</td>
        <td>${day.stockOutCount}</td>
      `;
      tbody.appendChild(tr);
    });

    const rangeTotals = summary.reduce((acc, day) => {
      acc.stockInCost += day.stockInCost;
      acc.stockOutSales += day.stockOutSales;
      acc.stockOutCost += day.stockOutCost;
      acc.profit += day.profit;
      acc.stockInCount += day.stockInCount;
      acc.stockOutCount += day.stockOutCount;
      return acc;
    }, { stockInCost: 0, stockOutSales: 0, stockOutCost: 0, profit: 0, stockInCount: 0, stockOutCount: 0 });

    const totalTr = document.createElement('tr');
    totalTr.style.background = 'rgba(99, 102, 241, 0.06)';
    totalTr.innerHTML = `
      <td style="font-weight: 800;">Range Total (${fromDate} to ${toDate})</td>
      <td style="font-weight: 700;">${formatCurrency(rangeTotals.stockInCost)}</td>
      <td style="font-weight: 700;">${formatCurrency(rangeTotals.stockOutSales)}</td>
      <td style="font-weight: 800; ${rangeTotals.profit < 0 ? 'color: var(--accent-danger);' : 'color: var(--accent-success);'}">${formatCurrency(rangeTotals.profit)}</td>
      <td>${rangeTotals.stockInCount}</td>
      <td>${rangeTotals.stockOutCount}</td>
    `;
    tbody.appendChild(totalTr);
  }

  renderProfitChart(summary);
}

function initProfitAnalyzerHandlers() {
  const refreshBtn = document.getElementById('profit-refresh-btn');
  const todayBtn = document.getElementById('profit-today-btn');
  const fromEl = document.getElementById('profit-date-from');
  const toEl = document.getElementById('profit-date-to');

  const today = new Date();
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10);

  if (fromEl && !fromEl.value) fromEl.value = thirtyDaysAgo;
  if (toEl && !toEl.value) toEl.value = localToday;

  if (refreshBtn) refreshBtn.addEventListener('click', renderProfitAnalyzer);
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      if (fromEl) fromEl.value = localToday;
      if (toEl) toEl.value = localToday;
      renderProfitAnalyzer();
    });
  }
  if (fromEl) fromEl.addEventListener('change', renderProfitAnalyzer);
  if (toEl) toEl.addEventListener('change', renderProfitAnalyzer);
}

// Render Dress Catalog Table with Search & Supplier Filter
function renderCatalogTable() {
  const tbody = document.getElementById('catalog-table-tbody');
  const searchVal = document.getElementById('catalog-search').value.toLowerCase();
  const supplierVal = document.getElementById('catalog-supplier-filter').value;

  tbody.innerHTML = '';

  const filtered = allItemsCache.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchVal) ||
      (item.description && item.description.toLowerCase().includes(searchVal)) ||
      (item.supplierName && item.supplierName.toLowerCase().includes(searchVal));
    
    const matchesSupplier = !supplierVal || item.supplierName === supplierVal;

    return matchesSearch && matchesSupplier;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 24px;">No dress items found matching criteria.</td></tr>';
    return;
  }

  filtered.forEach(item => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">${item.name}</div>
        <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 2px;">${item.description || 'No description'}</div>
      </td>
      <td>
        <div style="font-weight: 600; font-size: 0.875rem;">${item.supplierName}</div>
        <div style="font-size: 0.775rem; color: var(--text-muted);">${item.supplierContact || ''}</div>
      </td>
      <td style="font-weight: 600;">${formatCurrency(item.unitPrice || 0)}</td>
      <td style="font-weight: 700; color: var(--accent-primary);">${formatCurrency(item.totalValue || 0)}</td>
      <td style="font-weight: 700; font-size: 0.95rem;">${Number(item.quantity || 0)} pcs</td>
      <td>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-success btn-sm add-stock-btn" data-id="${item.id}" title="Add stock from this supplier">
            <i data-lucide="package-plus"></i> Add Stock
          </button>
          <button class="btn btn-secondary btn-sm edit-dress-btn" data-id="${item.id}" title="Edit Item" style="min-width:36px;">
            ✏️
          </button>
          <button class="btn btn-danger btn-sm delete-dress-btn" data-id="${item.id}" title="Delete Item" style="min-width:36px;">
            🗑️
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Event delegation is handled globally by initCatalogDelegation()
}


// Global event delegation for catalog edit/delete - attached ONCE to stable parent
function initCatalogDelegation() {
  const catalogCard = document.getElementById('catalog-tab');
  if (!catalogCard) return;

  catalogCard.addEventListener('click', async (e) => {
    const addStockBtn = e.target.closest('.add-stock-btn');
    const editBtn = e.target.closest('.edit-dress-btn');
    const deleteBtn = e.target.closest('.delete-dress-btn');

    if (addStockBtn) {
      pendingStockInItemId = Number(addStockBtn.getAttribute('data-id'));
      document.getElementById('nav-stock-in').click();
      return;
    }

    if (editBtn) {
      openDressModal(editBtn.getAttribute('data-id'));
      return;
    }

    if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-id');
      const item = allItemsCache.find(i => i.id === Number(id));
      if (!item) return;
      if (confirm(`Are you sure you want to delete "${item.name}" and its stock records? This cannot be undone.`)) {
        try {
          await deleteDressItem(id);
          await refreshAllData();
        } catch (err) {
          alert(`Failed to delete item: ${err.message}`);
        }
      }
    }
  });
}

function prefillStockInForm(itemId) {
  const item = allItemsCache.find(currentItem => currentItem.id === Number(itemId));
  if (!item) return;

  const container = document.getElementById('stock-in-items-container');
  const rows = getStockInEntryRows();
  const targetRow = rows[0] || null;

  if (!targetRow) {
    addStockInEntryRow();
  }

  const activeRow = getStockInEntryRows()[0];
  if (!activeRow) return;

  const itemSelect = activeRow.querySelector('.stock-in-entry-item');
  const qtyInput = activeRow.querySelector('.stock-in-entry-qty');
  const priceInput = activeRow.querySelector('.stock-in-entry-unit-price');

  if (itemSelect) itemSelect.value = String(item.id);
  if (priceInput) priceInput.value = Number(item.unitPrice || 0).toFixed(2);
  if (qtyInput) qtyInput.value = '1';
  const supplierInput = document.getElementById('stock-in-supplier');
  if (supplierInput && !supplierInput.value) supplierInput.value = item.supplierName || '';
  updateStockInEntryRowTotal(activeRow);
  updateStockInGrandTotal();
  qtyInput?.focus();
}

// Catalog Search / Filter Listeners
document.getElementById('catalog-search').addEventListener('input', renderCatalogTable);
document.getElementById('catalog-supplier-filter').addEventListener('change', renderCatalogTable);

// Modal Add / Edit Dress Item Handlers
function initModalHandlers() {
  const modal = document.getElementById('dress-modal');
  const addBtn = document.getElementById('add-new-dress-btn');
  const closeBtn = document.getElementById('dress-modal-close');
  const cancelBtn = document.getElementById('dress-modal-cancel');
  const form = document.getElementById('dress-item-form');
  const invoiceModal = document.getElementById('invoice-modal');
  const invoiceCloseBtn = document.getElementById('invoice-modal-close');
  const invoiceCloseFooterBtn = document.getElementById('invoice-modal-close-btn');
  const printInvoiceBtn = document.getElementById('invoice-print-btn');
  const transactionDetailModal = document.getElementById('transaction-detail-modal');
  const transactionDetailClose = document.getElementById('transaction-detail-close');
  const transactionDetailCancel = document.getElementById('transaction-detail-cancel');
  const transactionDetailSave = document.getElementById('transaction-detail-save');

  addBtn.addEventListener('click', () => openDressModal(null));
  closeBtn.addEventListener('click', closeDressModal);
  cancelBtn.addEventListener('click', closeDressModal);
  invoiceCloseBtn.addEventListener('click', closeInvoiceModal);
  invoiceCloseFooterBtn.addEventListener('click', closeInvoiceModal);
  printInvoiceBtn.addEventListener('click', () => {
    const invoice = currentInvoicePreview || currentSupplierSummaryInvoice;
    if (!invoice) {
      alert('There is no invoice to print yet.');
      return;
    }

    if (currentSupplierSummaryInvoice) {
      printSupplierSummaryInvoice(currentSupplierSummaryInvoice);
      return;
    }

    openPrintDocument(renderInvoiceHtml(invoice), `Invoice-${invoice.referenceNo || 'transaction'}`);
  });
  invoiceModal.addEventListener('click', (e) => {
    if (e.target === invoiceModal) closeInvoiceModal();
  });
  transactionDetailClose.addEventListener('click', closeTransactionDetailModal);
  transactionDetailCancel.addEventListener('click', closeTransactionDetailModal);
  transactionDetailModal.addEventListener('click', (e) => {
    if (e.target === transactionDetailModal) closeTransactionDetailModal();
  });
  transactionDetailSave.addEventListener('click', saveTransactionDetail);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('dress-id').value;
    const name = document.getElementById('dress-name').value.trim();
    const description = document.getElementById('dress-desc').value.trim();
    const supplierName = document.getElementById('dress-supplier-name').value.trim();
    const supplierContact = document.getElementById('dress-supplier-contact').value.trim();
    const unitPrice = Number(document.getElementById('dress-unit-price').value) || 0;
    const existingItem = id ? allItemsCache.find(item => item.id === Number(id)) : null;
    const quantity = existingItem ? Number(existingItem.quantity || 0) : 0;
    const totalValue = quantity * unitPrice;

    const itemData = { name, description, supplierName, supplierContact, quantity, unitPrice, totalValue };

    try {
      if (id) {
        await updateDressItem(id, itemData);
      } else {
        await addDressItem(itemData);
      }

      closeDressModal();
      await refreshAllData();
    } catch (err) {
      alert(`Error saving dress item: ${err.message}`);
    }
  });
}

function initVendorHandlers() {
  const form = document.getElementById('vendor-form');
  if (!form) return;
  const submitButton = document.getElementById('vendor-submit-btn');
  const cancelButton = document.getElementById('vendor-cancel-edit-btn');

  const resetVendorForm = () => {
    editingVendor = null;
    form.reset();
    submitButton.innerHTML = '<i data-lucide="plus"></i> Add Vendor';
    cancelButton.style.display = 'none';
    refreshIcons();
  };

  cancelButton.addEventListener('click', resetVendorForm);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const details = {
        name: document.getElementById('vendor-name').value,
        contact: document.getElementById('vendor-contact').value,
      };
      if (editingVendor) await updateVendor(editingVendor.id, { ...details, oldName: editingVendor.name });
      else await addVendor(details);
      resetVendorForm();
      await refreshAllData();
    } catch (err) {
      alert(`Failed to add vendor: ${err.message}`);
    }
  });
}

function renderVendorCatalog() {
  const tbody = document.getElementById('vendor-table-tbody');
  if (!tbody) return;
  if (!allVendorsCache.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-dim); padding: 24px;">No vendors added yet.</td></tr>';
    return;
  }
  tbody.innerHTML = allVendorsCache.map(vendor => `
    <tr>
      <td style="font-weight: 700;">${escapeHtml(vendor.name)}</td>
      <td>${escapeHtml(vendor.contact || 'No contact details')}</td>
      <td>${typeof vendor.id === 'number' ? `<button class="btn btn-secondary btn-sm edit-vendor-btn" data-vendor-id="${vendor.id}">Edit</button> <button class="btn btn-danger btn-sm delete-vendor-btn" data-vendor-id="${vendor.id}" data-vendor-name="${escapeHtml(vendor.name)}">Delete</button>` : '<span style="color: var(--text-dim); font-size: 0.8rem;">Used in records</span>'}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.edit-vendor-btn').forEach(button => button.addEventListener('click', () => {
    const vendor = allVendorsCache.find(item => Number(item.id) === Number(button.dataset.vendorId));
    if (!vendor) return;
    document.getElementById('vendor-name').value = vendor.name;
    document.getElementById('vendor-contact').value = vendor.contact || '';
    document.getElementById('vendor-submit-btn').innerHTML = '<i data-lucide="save"></i> Save Vendor';
    document.getElementById('vendor-cancel-edit-btn').style.display = 'inline-flex';
    editingVendor = vendor;
    refreshIcons();
  }));

  tbody.querySelectorAll('.delete-vendor-btn').forEach(button => button.addEventListener('click', async () => {
    if (!confirm(`Delete vendor "${button.dataset.vendorName}"? Existing stock records will be kept.`)) return;
    try {
      await deleteVendor(button.dataset.vendorId, button.dataset.vendorName);
      await refreshAllData();
    } catch (err) {
      alert(`Failed to delete vendor: ${err.message}`);
    }
  }));
}

function openDressModal(itemId = null) {
  const modal = document.getElementById('dress-modal');
  const titleEl = document.getElementById('dress-modal-title');
  const form = document.getElementById('dress-item-form');

  form.reset();
  document.getElementById('dress-id').value = '';

  if (itemId) {
    const item = allItemsCache.find(i => i.id === Number(itemId));
    if (item) {
      titleEl.textContent = 'Edit Dress Item Profile';
      document.getElementById('dress-id').value = item.id;
      document.getElementById('dress-name').value = item.name;
      document.getElementById('dress-desc').value = item.description || '';
      document.getElementById('dress-supplier-name').value = item.supplierName || '';
      document.getElementById('dress-supplier-contact').value = item.supplierContact || '';
      document.getElementById('dress-unit-price').value = item.unitPrice || 0;
    }
  } else {
    titleEl.textContent = 'Add New Dress Item';
    document.getElementById('dress-unit-price').value = 0;
  }

  modal.classList.add('active');
  refreshIcons();
}

function closeDressModal() {
  document.getElementById('dress-modal').classList.remove('active');
}

// Stock-In Form Handler
function initStockInForm() {
  const form = document.getElementById('stock-in-form');
  const datetimeInput = document.getElementById('stock-in-datetime');
  const supplierInput = document.getElementById('stock-in-supplier');
  const invoiceNoInput = document.getElementById('stock-in-invoice-no');
  const notesInput = document.getElementById('stock-in-notes');
  const grandTotalInput = document.getElementById('stock-in-grand-total');
  const addItemBtn = document.getElementById('stock-in-add-item-btn');
  const generateInvoiceBtn = document.getElementById('stock-in-generate-invoice-btn');

  datetimeInput.value = getLocalDatetimeString();
  addStockInEntryRow();

  addItemBtn.addEventListener('click', addStockInEntryRow);

  form.addEventListener('reset', () => {
    setTimeout(() => {
      const container = document.getElementById('stock-in-items-container');
      if (!container) return;
      container.innerHTML = '';
      addStockInEntryRow();
      datetimeInput.value = getLocalDatetimeString();
      if (grandTotalInput) grandTotalInput.value = '0.00';
    }, 0);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = getStockInEntryRows();
    const supplierName = supplierInput.value.trim();
    const timestamp = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();
    const invoiceNo = invoiceNoInput.value.trim();
    const notes = notesInput.value.trim();

    const validRows = rows.filter(row => {
      const itemSelect = row.querySelector('.stock-in-entry-item');
      const qtyInput = row.querySelector('.stock-in-entry-qty');
      const unitInput = row.querySelector('.stock-in-entry-unit-price');
      return itemSelect && itemSelect.value && Number(qtyInput.value || 0) > 0 && Number(unitInput.value || 0) >= 0;
    });

    if (!supplierName || !validRows.length) {
      alert('Please select a vendor and add at least one valid item for the stock-in batch.');
      return;
    }

    try {
      for (const row of validRows) {
        const itemId = row.querySelector('.stock-in-entry-item').value;
        const quantity = Number(row.querySelector('.stock-in-entry-qty').value || 0);
        const unitPrice = Number(row.querySelector('.stock-in-entry-unit-price').value || 0);

        await processStockIn({
          itemId,
          timestamp,
          supplierName,
          unitPrice,
          quantity,
          referenceNo: invoiceNo,
          notes,
          reasonCode: 'Stock Receiving',
        });
      }

      const totalAmount = validRows.reduce((sum, row) => {
        const qty = Number(row.querySelector('.stock-in-entry-qty').value || 0);
        const unitPrice = Number(row.querySelector('.stock-in-entry-unit-price').value || 0);
        return sum + qty * unitPrice;
      }, 0);

      alert(`Stock-In Logged Successfully! ${validRows.length} item line(s) recorded. Total: ${formatCurrency(totalAmount)}`);
      form.reset();
      datetimeInput.value = getLocalDatetimeString();
      await refreshAllData();
    } catch (err) {
      alert(`Failed to log Stock-In: ${err.message}`);
    }
  });

  generateInvoiceBtn.addEventListener('click', async () => {
    const supplierName = supplierInput.value.trim() || 'Supplier';
    const invoiceNo = invoiceNoInput.value.trim() || 'N/A';
    const notes = notesInput.value.trim();
    const rows = getStockInEntryRows();
    const timestamp = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();
    const preview = createStockInInvoicePreview({
      supplierName,
      invoiceNo,
      notes,
      timestamp,
      rows,
    });

    if (!preview) {
      alert('Please add at least one valid item row before generating an invoice.');
      return;
    }

    const validRows = rows.filter(row => {
      const itemSelect = row.querySelector('.stock-in-entry-item');
      const qtyInput = row.querySelector('.stock-in-entry-qty');
      const unitInput = row.querySelector('.stock-in-entry-unit-price');
      return itemSelect && itemSelect.value && Number(qtyInput.value || 0) > 0 && Number(unitInput.value || 0) >= 0;
    });

    if (!supplierName || !validRows.length) {
      alert('Please select a vendor and add at least one valid item for the stock-in batch.');
      return;
    }

    if (stockInPrintSubmitController.processing) {
      alert('Invoice generation is already in progress. Please wait.');
      return;
    }

    generateInvoiceBtn.disabled = true;
    generateInvoiceBtn.textContent = 'Printing...';

    try {
      currentInvoicePreview = preview;
      currentSupplierSummaryInvoice = null;

      const invoiceHtml = renderInvoiceHtml({
        type: 'IN',
        title: 'Stock-In Invoice',
        itemName: preview.items[0]?.itemName || 'Dress Item',
        supplierName,
        customerName: '',
        referenceNo: invoiceNo,
        quantity: preview.quantity,
        unitPrice: preview.items[0]?.unitPrice || 0,
        totalAmount: preview.totalAmount,
        timestamp: preview.timestamp,
        notes: preview.notes,
        description: preview.description,
        items: preview.items,
      });

      const result = await stockInPrintSubmitController.run({
        printFn: async () => {
          await openPrintDocument(invoiceHtml, `Stock-In-${invoiceNo || 'Receipt'}`);
        },
        submitFn: async () => {
          for (const row of validRows) {
            const itemId = row.querySelector('.stock-in-entry-item').value;
            const quantity = Number(row.querySelector('.stock-in-entry-qty').value || 0);
            const unitPrice = Number(row.querySelector('.stock-in-entry-unit-price').value || 0);

            await processStockIn({
              itemId,
              timestamp,
              supplierName,
              unitPrice,
              quantity,
              referenceNo: invoiceNo,
              notes,
              reasonCode: 'Stock Receiving',
            });
          }
        },
      });

      if (!result.ok) {
        if (result.duplicate) {
          alert(result.message);
          return;
        }
        alert(`Printing failed. Stock-In was not submitted. ${result.message}`);
        return;
      }

      const totalAmount = validRows.reduce((sum, row) => {
        const qty = Number(row.querySelector('.stock-in-entry-qty').value || 0);
        const unitPrice = Number(row.querySelector('.stock-in-entry-unit-price').value || 0);
        return sum + qty * unitPrice;
      }, 0);

      alert(`Stock-In Logged Successfully! ${validRows.length} item line(s) recorded. Total: ${formatCurrency(totalAmount)}`);
      form.reset();
      datetimeInput.value = getLocalDatetimeString();
      await refreshAllData();
    } catch (error) {
      alert(`Printing failed. Stock-In was not submitted. ${error.message || ''}`);
    } finally {
      generateInvoiceBtn.disabled = false;
      generateInvoiceBtn.textContent = 'Generate Invoice';
    }
  });
}

// Stock-Out Form Handler
function initStockOutForm() {
  const form = document.getElementById('stock-out-form');
  if (!form) return;

  const datetimeInput = document.getElementById('stock-out-datetime');
  const customerInput = document.getElementById('stock-out-customer');
  const supplierInput = document.getElementById('stock-out-supplier');
  const refInput = document.getElementById('stock-out-ref');
  const notesInput = document.getElementById('stock-out-notes');
  const grandTotalInput = document.getElementById('stock-out-grand-total');
  const generateInvoiceBtn = document.getElementById('stock-out-generate-invoice-btn');
  const addItemBtn = document.getElementById('stock-out-add-item-btn');
  const multiRowContainer = document.getElementById('stock-out-items-container');

  if (!multiRowContainer) {
    const itemSelect = document.getElementById('stock-out-item');
    const qtyInput = document.getElementById('stock-out-qty');
    const unitInput = document.getElementById('stock-out-unit-price');
    const totalInput = document.getElementById('stock-out-total-amount');
    const reasonInput = document.getElementById('stock-out-reason');

    if (datetimeInput) datetimeInput.value = getLocalDatetimeString();
    if (itemSelect) renderStockOutItemOptions(itemSelect);

    const recalcLegacyValue = () => {
      const qty = Number(qtyInput?.value || 0);
      const unitPrice = Number(unitInput?.value || 0);
      if (totalInput) totalInput.value = (qty * unitPrice).toFixed(2);
    };

    itemSelect?.addEventListener('change', () => {
      const selectedId = itemSelect.value;
      const item = allItemsCache.find(entry => Number(entry.id) === Number(selectedId));
      if (item && unitInput) {
        unitInput.value = Number(item.unitPrice || 0).toFixed(2);
      }
      recalcLegacyValue();
    });

    qtyInput?.addEventListener('input', recalcLegacyValue);
    unitInput?.addEventListener('input', recalcLegacyValue);

    form.addEventListener('reset', () => {
      setTimeout(() => {
        if (datetimeInput) datetimeInput.value = getLocalDatetimeString();
        if (itemSelect) itemSelect.value = '';
        if (qtyInput) qtyInput.value = '';
        if (unitInput) unitInput.value = '';
        if (totalInput) totalInput.value = '0.00';
      }, 0);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const selectedId = itemSelect?.value;
      const quantity = Number(qtyInput?.value || 0);
      const unitPrice = Number(unitInput?.value || 0);
      const supplierName = supplierInput?.value?.trim() || '';
      const customerName = customerInput?.value?.trim() || 'Customer';
      const referenceNo = refInput?.value?.trim() || 'N/A';
      const notes = notesInput?.value?.trim() || '';
      const reasonCode = reasonInput?.value || 'Wholesale Customer Sale';
      const timestamp = datetimeInput?.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();

      if (!selectedId) {
        alert('Please select a dress item for the stock-out transaction.');
        return;
      }

      const item = allItemsCache.find(entry => Number(entry.id) === Number(selectedId));
      if (!item) {
        alert('The selected dress item could not be found.');
        return;
      }

      if (!supplierName) {
        alert('Please select a vendor/supplier for the stock-out transaction.');
        return;
      }

      if (!quantity || quantity < 1) {
        alert('Please enter a quantity greater than zero.');
        return;
      }

      if (quantity > Number(item.quantity || 0)) {
        alert(`Insufficient stock for "${item.name}". Available: ${Number(item.quantity || 0)}, Requested: ${quantity}.`);
        return;
      }

      try {
        await processStockOut({
          itemId: selectedId,
          quantity,
          unitPrice,
          supplierName,
          customerName,
          referenceNo,
          reasonCode,
          notes,
          timestamp,
        });

        alert(`Stock-Out Logged Successfully! ${quantity} pcs deducted from ${item.name}. Total: ${formatCurrency(quantity * unitPrice)}`);
        form.reset();
        if (datetimeInput) datetimeInput.value = getLocalDatetimeString();
        await refreshAllData();
      } catch (err) {
        alert(`Stock-Out Error: ${err.message}`);
      }
    });

    if (generateInvoiceBtn) {
      generateInvoiceBtn.addEventListener('click', async () => {
        const selectedId = itemSelect?.value;
        const quantity = Number(qtyInput?.value || 0);
        const unitPrice = Number(unitInput?.value || 0);
        const supplierName = supplierInput?.value?.trim() || 'Supplier';
        const customerName = customerInput?.value?.trim() || 'Customer';
        const referenceNo = refInput?.value?.trim() || 'N/A';
        const notes = notesInput?.value?.trim() || '';
        const reasonCode = reasonInput?.value || 'Wholesale Customer Sale';

        if (!selectedId || !quantity || quantity < 1) {
          alert('Please select a valid item and quantity before generating an invoice.');
          return;
        }

        const item = allItemsCache.find(entry => Number(entry.id) === Number(selectedId));
        if (!item) {
          alert('The selected dress item could not be found.');
          return;
        }

        const preview = {
          id: Date.now(),
          type: 'OUT',
          supplierName,
          customerName,
          quantity,
          totalAmount: quantity * unitPrice,
          referenceNo,
          reasonCode,
          notes,
          description: item.description || '',
          timestamp: datetimeInput?.value || new Date().toISOString(),
          itemName: item.name,
          items: [{
            itemId: Number(selectedId),
            itemName: item.name,
            supplierName,
            customerName,
            quantity,
            unitPrice,
            totalAmount: quantity * unitPrice,
            referenceNo,
            reasonCode,
            notes,
            description: item.description || '',
            timestamp: datetimeInput?.value || new Date().toISOString(),
          }],
        };

        const invoiceHtml = renderInvoiceHtml({
          type: 'OUT',
          title: 'Stock-Out Invoice',
          itemName: preview.itemName,
          supplierName: preview.supplierName,
          customerName: preview.customerName,
          referenceNo: preview.referenceNo,
          quantity: preview.quantity,
          unitPrice: preview.items[0]?.unitPrice || 0,
          totalAmount: preview.totalAmount,
          timestamp: preview.timestamp,
          notes: preview.notes,
          description: preview.description,
          items: preview.items,
        });

        await openPrintDocument(invoiceHtml, `Stock-Out-${referenceNo}`);
      });
    }

    return;
  }

  datetimeInput.value = getLocalDatetimeString();
  addStockOutEntryRow();

  if (addItemBtn) addItemBtn.addEventListener('click', addStockOutEntryRow);

  form.addEventListener('reset', () => {
    setTimeout(() => {
      const container = document.getElementById('stock-out-items-container');
      if (!container) return;
      container.innerHTML = '';
      addStockOutEntryRow();
      if (datetimeInput) datetimeInput.value = getLocalDatetimeString();
      if (grandTotalInput) grandTotalInput.value = '0.00';
    }, 0);
  });

  const validateStockOutRows = () => {
    const rows = getStockOutEntryRows();
    const supplierName = supplierInput.value.trim();
    const customerName = customerInput.value.trim();
    const timestamp = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();
    const referenceNo = refInput.value.trim();
    const reasonCode = document.getElementById('stock-out-reason').value;
    const notes = notesInput.value.trim();

    const validRows = rows.filter(row => {
      const itemSelect = row.querySelector('.stock-out-entry-item');
      const qtyInput = row.querySelector('.stock-out-entry-qty');
      const unitInput = row.querySelector('.stock-out-entry-unit-price');
      return itemSelect && itemSelect.value && Number(qtyInput.value || 0) > 0 && Number(unitInput.value || 0) >= 0;
    });

    if (!supplierName || !customerName) {
      return { ok: false, message: 'Please select a vendor and enter the customer name for the stock-out batch.', validRows, reasonCode, notes, timestamp, referenceNo };
    }

    if (!validRows.length) {
      return { ok: false, message: 'Please add at least one valid item row for the stock-out batch.', validRows, reasonCode, notes, timestamp, referenceNo };
    }

    const seenItems = new Set();
    for (const row of validRows) {
      const itemSelect = row.querySelector('.stock-out-entry-item');
      const qtyInput = row.querySelector('.stock-out-entry-qty');
      const selectedId = itemSelect.value;
      const qty = Number(qtyInput.value) || 0;
      const item = allItemsCache.find(entry => Number(entry.id) === Number(selectedId));
      const available = Number(item?.quantity || 0);

      if (seenItems.has(selectedId)) {
        return { ok: false, message: `Duplicate item "${item?.name || 'Dress Item'}" in the same transaction. Please use one row per item.`, validRows, reasonCode, notes, timestamp, referenceNo };
      }
      seenItems.add(selectedId);

      if (qty > available) {
        return { ok: false, message: `Insufficient stock for "${item?.name || 'Dress Item'}". Available: ${available}, Requested: ${qty}.`, validRows, reasonCode, notes, timestamp, referenceNo };
      }
    }

    return { ok: true, message: '', validRows, reasonCode, notes, timestamp, referenceNo };
  };

  const buildStockOutItems = (validRows, reasonCode, notes, timestamp, referenceNo) => {
    const common = {
      timestamp,
      supplierName: supplierInput.value.trim(),
      customerName: customerInput.value.trim() || 'Customer',
      referenceNo: referenceNo || 'N/A',
      reasonCode,
      notes,
    };
    return validRows.map(row => {
      const itemId = row.querySelector('.stock-out-entry-item').value;
      const quantity = Number(row.querySelector('.stock-out-entry-qty').value || 0);
      const unitPrice = Number(row.querySelector('.stock-out-entry-unit-price').value || 0);
      return { itemId, quantity, unitPrice, ...common };
    });
  };

  const calculateGrandTotal = (validRows) => {
    return validRows.reduce((sum, row) => {
      const qty = Number(row.querySelector('.stock-out-entry-qty').value || 0);
      const unitPrice = Number(row.querySelector('.stock-out-entry-unit-price').value || 0);
      return sum + qty * unitPrice;
    }, 0);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const validation = validateStockOutRows();
    if (!validation.ok) {
      alert(validation.message);
      return;
    }

    const { validRows, reasonCode, notes, timestamp, referenceNo } = validation;
    const stockOutItems = buildStockOutItems(validRows, reasonCode, notes, timestamp, referenceNo);

    try {
      await processStockOutMulti(stockOutItems);
      const totalAmount = calculateGrandTotal(validRows);
      const totalQty = validRows.reduce((sum, row) => sum + Number(row.querySelector('.stock-out-entry-qty').value || 0), 0);
      alert(`Stock-Out Logged Successfully! ${validRows.length} item line(s) recorded, ${totalQty} pcs deducted. Total: ${formatCurrency(totalAmount)}`);
      form.reset();
      datetimeInput.value = getLocalDatetimeString();
      await refreshAllData();
    } catch (err) {
      alert(`Stock-Out Error: ${err.message}`);
    }
  });

  if (generateInvoiceBtn) {
    generateInvoiceBtn.addEventListener('click', async () => {
      const validation = validateStockOutRows();
      if (!validation.ok) {
        alert(validation.message);
        return;
      }

      const { validRows, reasonCode, notes, timestamp, referenceNo } = validation;
      const preview = createStockOutInvoicePreview({
        supplierName: supplierInput.value.trim() || 'Supplier',
        customerName: customerInput.value.trim() || 'Customer',
        invoiceNo: refInput.value.trim() || 'N/A',
        notes,
        reasonCode,
        timestamp,
        rows: validRows,
      });

      if (!preview) {
        alert('Please add at least one valid item row before generating an invoice.');
        return;
      }

      if (stockOutPrintSubmitController.processing) {
        alert('Invoice generation is already in progress. Please wait.');
        return;
      }

      generateInvoiceBtn.disabled = true;
      generateInvoiceBtn.textContent = 'Printing...';

      try {
        currentInvoicePreview = preview;
        currentSupplierSummaryInvoice = null;

        const invoiceHtml = renderInvoiceHtml({
          type: 'OUT',
          title: 'Stock-Out Invoice',
          itemName: preview.items[0]?.itemName || 'Dress Item',
          supplierName: preview.supplierName,
          customerName: preview.customerName,
          referenceNo: preview.referenceNo,
          quantity: preview.quantity,
          unitPrice: preview.items[0]?.unitPrice || 0,
          totalAmount: preview.totalAmount,
          timestamp: preview.timestamp,
          notes: preview.notes,
          description: preview.description,
          items: preview.items,
        });

        const stockOutItems = buildStockOutItems(validRows, reasonCode, notes, timestamp, referenceNo);

        const result = await stockOutPrintSubmitController.run({
          printFn: async () => {
            await openPrintDocument(invoiceHtml, `Stock-Out-${preview.referenceNo || 'Receipt'}`);
          },
          submitFn: async () => {
            await processStockOutMulti(stockOutItems);
          },
        });

        if (!result.ok) {
          alert(result.duplicate
            ? result.message
            : `Printing failed. Stock-Out was not submitted. ${result.message}`);
          return;
        }

        const totalAmount = calculateGrandTotal(validRows);
        const totalQty = validRows.reduce((sum, row) => sum + Number(row.querySelector('.stock-out-entry-qty').value || 0), 0);
        alert(`Stock-Out Logged Successfully! ${validRows.length} item line(s) recorded, ${totalQty} pcs deducted. Total: ${formatCurrency(totalAmount)}`);
        form.reset();
        datetimeInput.value = getLocalDatetimeString();
        await refreshAllData();
      } catch (error) {
        alert(`Printing failed. Stock-Out was not submitted. ${error.message || ''}`);
      } finally {
        generateInvoiceBtn.disabled = false;
        generateInvoiceBtn.textContent = 'Generate Invoice';
      }
    });
  }
}

// Reports & CSV Exporters
function initReportsHandlers() {
  const rptNavStock = document.getElementById('rpt-nav-current');
  const rptNavMove = document.getElementById('rpt-nav-movement');
  const rptNavVal = document.getElementById('rpt-nav-valuation');

  const viewStock = document.getElementById('report-view-stock');
  const viewMove = document.getElementById('report-view-movement');
  const viewVal = document.getElementById('report-view-valuation');

  const switchReportView = (activeBtn, activeView) => {
    [rptNavStock, rptNavMove, rptNavVal].forEach(b => b.classList.remove('active'));
    [viewStock, viewMove, viewVal].forEach(v => v.style.display = 'none');
    activeBtn.classList.add('active');
    activeView.style.display = 'block';
  };

  rptNavStock.addEventListener('click', () => switchReportView(rptNavStock, viewStock));
  rptNavMove.addEventListener('click', () => switchReportView(rptNavMove, viewMove));
  rptNavVal.addEventListener('click', () => switchReportView(rptNavVal, viewVal));

  // Search & Filter listeners for reports
  document.getElementById('rpt-stock-search').addEventListener('input', renderReportStock);
  const stockStatusFilter = document.getElementById('rpt-stock-status-filter');
  if (stockStatusFilter) {
    stockStatusFilter.addEventListener('change', renderReportStock);
  }

  document.getElementById('rpt-movement-search').addEventListener('input', renderReportMovement);
  document.getElementById('rpt-movement-type-filter').addEventListener('change', renderReportMovement);
  document.getElementById('rpt-movement-reason-filter').addEventListener('change', renderReportMovement);
  const supplierSummaryFilter = document.getElementById('rpt-supplier-summary-filter');
  const dailyDateFilter = document.getElementById('rpt-daily-date-filter');
  if (supplierSummaryFilter) {
    supplierSummaryFilter.addEventListener('input', () => {
      renderSupplierDailySummary();
      renderSupplierOverallSummary();
    });
  }
  if (dailyDateFilter) dailyDateFilter.addEventListener('change', renderSupplierDailySummary);
  const generateSupplierInvoiceBtn = document.getElementById('generate-supplier-invoice-btn');
  if (generateSupplierInvoiceBtn) generateSupplierInvoiceBtn.addEventListener('click', generateSupplierInvoice);
  const downloadSupplierHistoryBtn = document.getElementById('download-supplier-history-btn');
  if (downloadSupplierHistoryBtn) downloadSupplierHistoryBtn.addEventListener('click', downloadSupplierHistory);
  const downloadCurrentInvoiceBtn = document.getElementById('download-current-invoice-btn');
  if (downloadCurrentInvoiceBtn) {
    downloadCurrentInvoiceBtn.addEventListener('click', () => {
      if (currentSupplierSummaryInvoice) printSupplierSummaryInvoice(currentSupplierSummaryInvoice);
      else alert('Generate a supplier invoice first.');
    });
  }

  const movementTable = document.getElementById('rpt-movement-tbody');
  if (movementTable) {
    movementTable.addEventListener('click', async (e) => {
      const viewBtn = e.target.closest('.view-transaction-btn');
      if (viewBtn) {
        const tx = allTransactionsCache.find(entry => Number(entry.id) === Number(viewBtn.dataset.txId));
        if (tx) openTransactionDetailModal(tx);
        return;
      }

      const deleteBtn = e.target.closest('.delete-transaction-btn');
      if (deleteBtn) {
        const txId = Number(deleteBtn.dataset.txId);
        const tx = allTransactionsCache.find(entry => Number(entry.id) === txId);
        if (!tx) return;

        const movementLabel = tx.type === 'IN' ? 'stock-in' : 'stock-out';
        const confirmMessage = `Delete this ${movementLabel} movement? This will reverse the item quantity in stock and remove it from the movement log.`;
        if (!confirm(confirmMessage)) return;

        try {
          await deleteTransaction(txId);
          await refreshAllData();
          alert(`✅ ${movementLabel.charAt(0).toUpperCase() + movementLabel.slice(1)} movement deleted successfully.`);
        } catch (err) {
          alert(`Failed to delete movement: ${err.message}`);
        }
        return;
      }

      const btn = e.target.closest('.reverse-stock-btn');
      if (!btn) return;

      const txId = Number(btn.getAttribute('data-tx-id'));
      const itemId = Number(btn.getAttribute('data-item-id'));
      const qty = Number(btn.getAttribute('data-qty')) || 0;
      const itemName = btn.getAttribute('data-item-name');
      const supplierName = btn.getAttribute('data-supplier-name') || '';
      const refNo = btn.getAttribute('data-reference-no') || 'N/A';

      const tx = allTransactionsCache.find(entry => Number(entry.id) === txId);
      if (!tx) return;

      const confirmMessage = `This will add ${qty} piece(s) back into stock for ${itemName} and keep the original mistaken stock-out record in the log for audit purposes.`;
      if (!confirm(confirmMessage)) return;

      try {
        await recordStockCorrection({
          itemId,
          quantity: qty,
          reasonCode: 'Stock Correction / Restock',
          notes: `Restock to fix mistaken stock-out on ${tx.referenceNo || 'manual correction'}.`,
          timestamp: new Date().toISOString(),
          supplierName,
          customerName: tx.customerName || '',
          referenceNo: refNo,
        });
        await refreshAllData();
        alert(`✅ ${qty} piece(s) of ${itemName} have been restocked successfully.`);
      } catch (err) {
        alert(`Failed to restock item: ${err.message}`);
      }
    });
  }

  // CSV Export Listeners
  document.getElementById('export-stock-csv').addEventListener('click', exportStockCSV);
  document.getElementById('export-movement-csv').addEventListener('click', exportMovementCSV);
  document.getElementById('export-valuation-csv').addEventListener('click', exportValuationCSV);
}

function renderReports() {
  renderReportStock();
  renderReportMovement();
  renderReportValuation();

  const dateFilter = document.getElementById('rpt-daily-date-filter');
  if (dateFilter && !dateFilter.value) {
    dateFilter.value = new Date().toISOString().slice(0, 10);
  }

  renderSupplierDailySummary();
  renderSupplierOverallSummary();
}

// Report 1: Real-Time Current Stock Level
function openInvoiceModal({ type, title, itemName, partyName, referenceNo, quantity, unitPrice, totalAmount, date, notes, description, items = [] }) {
  const modal = document.getElementById('invoice-modal');
  const content = document.getElementById('invoice-content');
  const invoiceDate = date ? new Date(date) : new Date();
  const formattedDate = invoiceDate.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const rows = items.length
    ? items
    : [{ itemName: itemName || 'Dress Item', quantity: quantity || 0, unitPrice: unitPrice || 0, totalAmount: totalAmount || 0, description: description || 'Stock entry' }];

  const totalValue = Number(totalAmount || rows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0));

  content.innerHTML = `
    <div style="border: 1px solid var(--border-color); border-radius: 14px; padding: 20px; background: rgba(15, 23, 42, 0.02);">
      <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 18px;">
        <div>
          <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim);">${title}</div>
          <div style="font-size: 1.5rem; font-weight: 800; margin-top: 4px;">DressStock Shop</div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700;">${type === 'IN' ? 'Stock-In' : 'Stock-Out'}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${formattedDate}</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px;">
        <div><div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim);">Reference</div><div style="font-weight: 700; margin-top: 4px;">${referenceNo}</div></div>
        <div><div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim);">${type === 'IN' ? 'Supplier' : 'Customer'}</div><div style="font-weight: 700; margin-top: 4px;">${partyName}</div></div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <thead>
          <tr style="background: rgba(99, 102, 241, 0.08);">
            <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color);">Item</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Qty</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Unit Price</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td style="padding: 12px; border-bottom: 1px solid var(--border-color);">${row.itemName || 'Dress Item'}</td>
              <td style="padding: 12px; text-align: right; border-bottom: 1px solid var(--border-color);">${Number(row.quantity || 0)}</td>
              <td style="padding: 12px; text-align: right; border-bottom: 1px solid var(--border-color);">${formatCurrency(Number(row.unitPrice || 0))}</td>
              <td style="padding: 12px; text-align: right; border-bottom: 1px solid var(--border-color); font-weight: 700;">${formatCurrency(Number(row.totalAmount || 0))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 18px;">
        <div style="color: var(--text-muted); font-size: 0.82rem;">${notes || 'No notes added.'}</div>
        <div style="font-size: 1.2rem; font-weight: 800;">Total: ${formatCurrency(totalValue)}</div>
      </div>
    </div>
  `;

  modal.classList.add('active');
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal').classList.remove('active');
}

function openTransactionDetailModal(tx) {
  const modal = document.getElementById('transaction-detail-modal');
  const content = document.getElementById('transaction-detail-content');
  const dateValue = tx.timestamp ? new Date(tx.timestamp).toISOString().slice(0, 10) : '';
  const partyLabel = tx.type === 'IN' ? 'Supplier' : 'Customer';
  const partyValue = tx.type === 'IN' ? (tx.supplierName || 'N/A') : (tx.customerName || 'N/A');

  content.innerHTML = `
    <div class="transaction-detail-grid">
      <div><span>Transaction type</span><strong>${tx.type === 'IN' ? 'Stock-In' : 'Stock-Out'}</strong></div>
      <div><span>Item name</span><strong>${tx.itemName || 'N/A'}</strong></div>
      <div><span>${partyLabel}</span><strong>${partyValue}</strong></div>
      <div><span>Reference</span><strong>${tx.referenceNo || 'N/A'}</strong></div>
      <div><span>Quantity</span><strong>${tx.quantity} pcs</strong></div>
      <div><span>Unit price</span><strong>${formatCurrency(tx.unitPrice)}</strong></div>
      <div><span>Total amount</span><strong>${formatCurrency(tx.totalAmount)}</strong></div>
      <div><span>Reason</span><strong>${tx.reasonCode || 'N/A'}</strong></div>
      <div class="transaction-detail-wide"><span>Notes</span><strong>${tx.notes || 'No notes added.'}</strong></div>
    </div>
    <div class="transaction-edit-fields">
      <div class="form-group">
        <label for="transaction-edit-supplier">Supplier name</label>
        <input id="transaction-edit-supplier" class="form-control form-control-simple" value="${escapeHtml(tx.supplierName || '')}" required>
      </div>
      <div class="form-group">
        <label for="transaction-edit-date">Transaction date</label>
        <input type="date" id="transaction-edit-date" class="form-control form-control-simple" value="${dateValue}" required>
      </div>
    </div>
  `;
  modal.dataset.transactionId = tx.id;
  modal.classList.add('active');
  refreshIcons();
}

async function saveTransactionDetail() {
  const modal = document.getElementById('transaction-detail-modal');
  const transactionId = Number(modal.dataset.transactionId);
  const supplierName = document.getElementById('transaction-edit-supplier').value.trim();
  const date = document.getElementById('transaction-edit-date').value;

  try {
    await updateTransactionSupplierAndDate(transactionId, { supplierName, date });
    closeTransactionDetailModal();
    await refreshAllData();
    alert('Transaction supplier and date updated everywhere.');
  } catch (err) {
    alert(`Failed to update transaction: ${err.message}`);
  }
}

function closeTransactionDetailModal() {
  document.getElementById('transaction-detail-modal').classList.remove('active');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function renderInvoiceList() {
  const container = document.getElementById('invoice-list-container');
  if (!container) return;

  if (!allTransactionsCache.length) {
    container.innerHTML = '<div style="padding: 12px; color: var(--text-dim);">No invoices available yet.</div>';
    return;
  }

  const invoiceCards = [...allTransactionsCache].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map(tx => {
    const typeLabel = tx.type === 'IN' ? 'Stock-In' : 'Stock-Out';
    const party = tx.type === 'IN' ? (tx.supplierName || 'Supplier') : (tx.customerName || 'Customer');
    const amount = Number(tx.totalAmount || 0);
    return `
      <button class="invoice-list-item" data-invoice-id="${tx.id}" data-invoice-type="${tx.type}" style="width: 100%; text-align: left; padding: 12px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-input); color: var(--text-main); cursor: pointer; display: block;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="font-weight: 700;">${tx.itemName || 'Dress Item'}</span>
          <span class="badge ${tx.type === 'IN' ? 'badge-in' : 'badge-out'}">${typeLabel}</span>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">${formatDate(tx.timestamp)}</div>
        <div style="font-size: 0.82rem; color: var(--text-muted);">${party} • Ref: ${tx.referenceNo || 'N/A'}</div>
        <div style="margin-top: 8px; font-weight: 700;">${formatCurrency(amount)}</div>
      </button>
    `;
  }).join('');

  container.innerHTML = invoiceCards;

  container.querySelectorAll('.invoice-list-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const txId = Number(btn.getAttribute('data-invoice-id'));
      const tx = allTransactionsCache.find(item => Number(item.id) === txId);
      if (!tx) return;
      currentInvoicePreview = tx;
      currentSupplierSummaryInvoice = null;
      renderInvoiceDetail(tx);
    });
  });
}

function renderInvoiceDetail(tx) {
  const container = document.getElementById('invoice-detail-container');
  if (!container) return;

  const typeLabel = tx.type === 'IN' ? 'Stock-In Invoice' : 'Stock-Out Invoice';
  const invoiceDate = tx.timestamp ? new Date(tx.timestamp) : new Date();
  const partyName = tx.type === 'IN' ? (tx.supplierName || 'Supplier') : (tx.customerName || 'Customer');
  const rows = (tx.items && tx.items.length ? tx.items : [{ itemName: tx.itemName || 'Dress Item', quantity: tx.quantity || 0, unitPrice: tx.unitPrice || 0, totalAmount: tx.totalAmount || 0, referenceNo: tx.referenceNo || 'N/A' }]);

  const itemRows = rows.map(row => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${row.itemName || 'Dress Item'}</td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid var(--border-color);">${Number(row.quantity || 0)} pcs</td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid var(--border-color);">${formatCurrency(Number(row.unitPrice || 0))}</td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid var(--border-color); font-weight: 700;">${formatCurrency(Number(row.totalAmount || 0))}</td>
    </tr>
  `).join('');

  const html = `
    <div style="border: 1px solid var(--border-color); border-radius: 14px; padding: 18px; background: rgba(15, 23, 42, 0.02);">
      <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 16px;">
        <div>
          <div style="font-size: 0.72rem; letter-spacing: 0.08em; color: var(--text-dim); text-transform: uppercase;">${typeLabel}</div>
          <div style="font-size: 1.4rem; font-weight: 800; margin-top: 4px;">DressStock Shop</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 0.8rem; color: var(--text-muted);">${invoiceDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
          <div style="font-weight: 700; margin-top: 4px;">${tx.referenceNo || 'N/A'}</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px;">
        <div>
          <div style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim);">${tx.type === 'IN' ? 'Supplier' : 'Customer'}</div>
          <div style="font-weight: 700; margin-top: 4px;">${partyName}</div>
        </div>
        <div>
          <div style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim);">Reason</div>
          <div style="font-weight: 700; margin-top: 4px;">${tx.reasonCode || 'N/A'}</div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <thead>
          <tr style="background: rgba(99, 102, 241, 0.08);">
            <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color);">Item</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Qty</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Unit Price</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <div style="color: var(--text-muted); font-size: 0.8rem;">${tx.notes || 'No notes added.'}</div>
        <div style="font-size: 1.2rem; font-weight: 800;">Total: ${formatCurrency(Number(tx.totalAmount || rows.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0)))}</div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function renderSupplierSummaryDetail(summary) {
  const container = document.getElementById('invoice-detail-container');
  if (!container || !summary) return;

  const rows = summary.items.map(item => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${item.itemName}</td>
      <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${item.time ? new Date(item.time).toLocaleDateString('en-GB') : summary.date}</td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid var(--border-color);">${item.quantity}</td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid var(--border-color);">${formatCurrency(item.unitPrice)}</td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid var(--border-color);">${formatCurrency(item.totalAmount)}</td>
      <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${item.referenceNo || 'N/A'}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div style="border: 1px solid var(--border-color); border-radius: 14px; padding: 18px; background: rgba(15, 23, 42, 0.02);">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px;">
        <div>
          <div style="font-size: 0.72rem; letter-spacing: 0.08em; color: var(--text-dim); text-transform: uppercase;">Supplier Daily Summary Invoice</div>
          <div style="font-size: 1.4rem; font-weight: 800; margin-top: 4px;">DressStock Shop</div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700;">${summary.supplierName}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${summary.date}</div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px;">
        <thead>
          <tr style="background: rgba(99, 102, 241, 0.08);">
            <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color);">Item</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color);">Date</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Qty</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Unit Price</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Line Total</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color);">Ref</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <div style="color: var(--text-muted); font-size: 0.8rem;">${summary.transactionCount} stock-in entries · ${summary.totalQty} pieces</div>
        <div style="font-size: 1.2rem; font-weight: 800;">Total: ${formatCurrency(summary.totalAmount)}</div>
      </div>
    </div>
  `;
}

function printInvoice(invoice) {
  const target = invoice || currentInvoicePreview;
  if (!target) {
    alert('Select an invoice to print.');
    return;
  }

  openPrintDocument(renderInvoiceHtml(target), `Invoice-${target.referenceNo || 'transaction'}`);
}

function renderInvoiceHtml(invoice) {
  const rows = (invoice.items && invoice.items.length ? invoice.items : [{ itemName: invoice.itemName || 'Dress Item', quantity: invoice.quantity || 0, unitPrice: invoice.unitPrice || 0, totalAmount: invoice.totalAmount || 0 }]);
  const body = rows.map(row => `
    <tr>
      <td>${row.itemName || 'Dress Item'}</td>
      <td>${row.quantity || 0}</td>
      <td>${formatCurrency(Number(row.unitPrice || 0))}</td>
      <td>${formatCurrency(Number(row.totalAmount || 0))}</td>
    </tr>
  `).join('');

  const totalValue = Number(invoice.totalAmount || rows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0));

  return `
    <div class="thermal-receipt">
      <div class="thermal-header">
        <div class="thermal-brand">${RECEIPT_SHOP_NAME}</div>
        <div class="thermal-subtitle">${invoice.type === 'IN' ? 'Stock-In Receipt' : 'Stock-Out Receipt'}</div>
      </div>

      <div class="thermal-meta">
        <div><span>Date</span><strong>${new Date(invoice.timestamp).toLocaleString()}</strong></div>
        <div><span>${invoice.type === 'IN' ? 'Supplier' : 'Customer'}</span><strong>${invoice.type === 'IN' ? (invoice.supplierName || 'Supplier') : (invoice.customerName || 'Customer')}</strong></div>
        <div><span>Reference</span><strong>${invoice.referenceNo || 'N/A'}</strong></div>
      </div>

      <table class="thermal-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Amt</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>

      <div class="thermal-total-row">
        <span>Total</span>
        <strong>${formatCurrency(totalValue)}</strong>
      </div>
    </div>
  `;
}

function renderSupplierSummaryHtml(summary) {
  const rows = summary.items.map(item => `
    <tr>
      <td>${item.time ? new Date(item.time).toLocaleDateString('en-GB') : summary.date}</td>
      <td>${item.itemName}</td>
      <td>${item.quantity}</td>
      <td>${formatCurrency(item.unitPrice)}</td>
      <td>${formatCurrency(item.totalAmount)}</td>
      <td>${item.referenceNo || 'N/A'}</td>
    </tr>
  `).join('');
  return `
    <div class="print-invoice">
      <header class="print-invoice-header"><div><p class="print-kicker">Supplier invoice</p><h1>DressStock Shop</h1><p>Stock-in receipt summary</p></div><div class="print-meta"><strong>${summary.supplierName}</strong><span>Invoice date: ${summary.date}</span></div></header>
      <table><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Unit Price</th><th>Line Total</th><th>Reference</th></tr></thead><tbody>${rows}</tbody></table>
      <footer class="print-invoice-total"><span>${summary.transactionCount} entries · ${summary.totalQty} pieces</span><strong>Total ${formatCurrency(summary.totalAmount)}</strong></footer>
    </div>
  `;
}

function printSupplierSummaryInvoice(summary) {
  openPrintDocument(renderSupplierSummaryHtml(summary), `Supplier-Invoice-${summary.supplierName}-${summary.date}`);
}

function printSupplierHistoryDocument(supplierName, summary) {
  const rows = summary.flatMap(day => day.items.map(item => `
    <tr>
      <td>${day.date}</td>
      <td>${item.itemName}</td>
      <td>${item.quantity}</td>
      <td>${formatCurrency(item.unitPrice)}</td>
      <td>${formatCurrency(item.totalAmount)}</td>
      <td>${item.referenceNo || 'N/A'}</td>
    </tr>
  `)).join('');
  const totalQty = summary.reduce((total, row) => total + row.totalQty, 0);
  const totalAmount = summary.reduce((total, row) => total + row.totalAmount, 0);
  const html = `<div class="print-invoice">
    <header class="print-invoice-header"><div><p class="print-kicker">Supplier transaction history</p><h1>DressStock Shop</h1><p>Overall stock-in statement</p></div><div class="print-meta"><strong>${supplierName}</strong><span>All recorded dates</span></div></header>
    <table><thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Unit Price</th><th>Line Total</th><th>Reference</th></tr></thead><tbody>${rows}</tbody></table>
    <footer class="print-invoice-total"><span>${totalQty} pieces across ${summary.length} days</span><strong>Total ${formatCurrency(totalAmount)}</strong></footer>
  </div>`;
  openPrintDocument(html, `Supplier-History-${supplierName}`);
}

function openPrintDocument(content, title) {
  return new Promise((resolve, reject) => {
    const printWindow = window.open('', '_blank', 'width=0,height=0,menubar=no,toolbar=no,location=no,status=no');
    if (!printWindow) {
      reject(new Error('Please allow pop-ups to print the invoice.'));
      return;
    }

    printWindow.document.write(`<!doctype html><html><head><title>${title}</title><meta charset="utf-8"><style>${printDocumentStyles()}</style></head><body>${content}</body></html>`);
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      try {
        printWindow.print();
      } catch (error) {
        console.warn('Printer print call failed:', error);
        reject(error);
        return;
      }

      setTimeout(() => {
        try {
          printWindow.close();
        } catch (error) {
          console.warn('Print window close failed:', error);
        }
        resolve(true);
      }, 1200);
    }, 250);
  });
}

function printDocumentStyles() {
  return `@page { size: ${RECEIPT_WIDTH_MM}mm auto; margin: 0; } * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: #fff; } body { width: ${RECEIPT_WIDTH_MM}mm; max-width: ${RECEIPT_WIDTH_MM}mm; font-family: Arial, sans-serif; color: #111; overflow: hidden; } .thermal-receipt { width: ${RECEIPT_WIDTH_MM}mm; max-width: ${RECEIPT_WIDTH_MM}mm; padding: 4mm; } .thermal-header { text-align: center; border-bottom: 1px dashed #333; padding-bottom: 3mm; margin-bottom: 3mm; } .thermal-brand { font-size: 18px; font-weight: 700; letter-spacing: 0.04em; } .thermal-subtitle { font-size: 12px; margin-top: 1mm; text-transform: uppercase; } .thermal-meta { display: grid; gap: 2mm; font-size: 11px; margin-bottom: 3mm; } .thermal-meta div { display: flex; flex-direction: column; gap: 1mm; } .thermal-meta span { color: #444; text-transform: uppercase; font-size: 10px; } .thermal-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; } .thermal-table th, .thermal-table td { border-bottom: 1px dashed #ddd; padding: 1.8mm 0.6mm; vertical-align: top; text-align: left; word-wrap: break-word; } .thermal-table th:nth-child(2), .thermal-table td:nth-child(2), .thermal-table th:nth-child(3), .thermal-table td:nth-child(3), .thermal-table th:nth-child(4), .thermal-table td:nth-child(4) { text-align: right; } .thermal-total-row { display: flex; justify-content: space-between; align-items: center; margin-top: 3mm; padding-top: 3mm; border-top: 1px solid #111; font-size: 12px; font-weight: 700; } .print-invoice { width: 100%; } .print-invoice-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a5f; padding-bottom: 22px; margin-bottom: 28px; } h1 { margin: 4px 0; font-size: 28px; letter-spacing: .02em; } p { margin: 0; color: #64748b; } .print-kicker { color: #1e3a5f; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; } .print-meta { display: grid; gap: 5px; text-align: right; font-size: 14px; } .print-meta span { color: #64748b; } table { width: 100%; border-collapse: collapse; } th { background: #e8eef5; color: #233a56; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; } th, td { border-bottom: 1px solid #d9e0e8; padding: 11px 9px; text-align: left; } td:nth-child(3), td:nth-child(4), td:nth-child(5), th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: right; } .print-invoice-total { display: flex; justify-content: space-between; border-top: 2px solid #1e3a5f; margin-top: 22px; padding-top: 16px; font-size: 15px; } .print-invoice-total strong { font-size: 20px; }`;
}

function renderReportStock() {
  const tbody = document.getElementById('rpt-stock-tbody');
  const searchVal = document.getElementById('rpt-stock-search').value.toLowerCase();
  const statusVal = document.getElementById('rpt-stock-status-filter').value;

  tbody.innerHTML = '';
  const rows = [];

  allItemsCache.forEach(item => {
    const stockQuantity = Number(item.quantity || 0);
    const matchesSearch = item.name.toLowerCase().includes(searchVal) || (item.supplierName || '').toLowerCase().includes(searchVal);

    let matchesStatus = true;
    if (statusVal === 'in_stock') matchesStatus = stockQuantity > 0;
    if (statusVal === 'low_stock') matchesStatus = stockQuantity > 0 && stockQuantity <= 15;
    if (statusVal === 'out_of_stock') matchesStatus = stockQuantity === 0;

    if (matchesSearch && matchesStatus) {
      rows.push({
        name: item.name,
        supplier: item.supplierName || 'General Supplier',
        stockQuantity,
        unitPrice: Number(item.unitPrice || 0),
        totalValue: Number(item.totalValue || 0),
      });
    }
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 24px;">No inventory records match filters.</td></tr>';
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');
    let statusBadge = '<span class="badge badge-in">In Stock</span>';
    if (r.stockQuantity === 0) statusBadge = '<span class="badge badge-out">Out of Stock</span>';
    else if (r.stockQuantity <= 15) statusBadge = '<span class="badge badge-warning">Low Stock</span>';

    tr.innerHTML = `
      <td style="font-weight: 600;">${r.name}</td>
      <td>${r.supplier}</td>
      <td style="font-weight: 800;">${r.stockQuantity} pcs</td>
      <td>${formatCurrency(r.unitPrice)}</td>
      <td>${formatCurrency(r.totalValue)}</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Report 2: Stock Movement Log
function renderReportMovement() {
  const tbody = document.getElementById('rpt-movement-tbody');
  const searchVal = document.getElementById('rpt-movement-search').value.toLowerCase();
  const typeVal = document.getElementById('rpt-movement-type-filter').value;
  const reasonVal = document.getElementById('rpt-movement-reason-filter').value;

  tbody.innerHTML = '';

  const filtered = allTransactionsCache.filter(tx => {
    const matchesSearch = (tx.itemName && tx.itemName.toLowerCase().includes(searchVal)) ||
      (tx.customerName && tx.customerName.toLowerCase().includes(searchVal)) ||
      (tx.supplierName && tx.supplierName.toLowerCase().includes(searchVal)) ||
      (tx.referenceNo && tx.referenceNo.toLowerCase().includes(searchVal));

    const matchesType = !typeVal || tx.type === typeVal;
    const matchesReason = !reasonVal || tx.reasonCode === reasonVal;

    return matchesSearch && matchesType && matchesReason;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--text-dim); padding: 24px;">No movement transactions found.</td></tr>';
    renderSupplierDailySummary();
    return;
  }

  filtered.forEach(tx => {
    const tr = document.createElement('tr');
    const badgeClass = tx.type === 'IN' ? 'badge-in' : 'badge-out';
    const badgeText = tx.type === 'IN' ? 'Stock-In' : 'Stock-Out';
    const party = tx.type === 'IN' ? (tx.supplierName || 'N/A') : (tx.customerName || 'N/A');
    const ref = tx.referenceNo && tx.referenceNo !== 'N/A' ? ` (Ref: ${tx.referenceNo})` : '';
    const canReverse = tx.type === 'OUT';

    tr.innerHTML = `
      <td style="font-size: 0.825rem; color: var(--text-muted);">${formatDate(tx.timestamp)}</td>
      <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      <td style="font-weight: 600;">${tx.itemName}</td>
      <td style="font-size: 0.85rem; color: var(--text-muted);">${tx.description || tx.notes || 'Single item stock'}</td>
      <td style="font-weight: 800;">${tx.type === 'IN' ? '+' : '-'}${tx.quantity} pcs</td>
      <td>${formatCurrency(Number(tx.unitPrice || 0))}</td>
      <td>${formatCurrency(Number(tx.totalAmount || 0))}</td>
      <td style="font-size: 0.85rem;">${tx.reasonCode}</td>
      <td style="font-size: 0.85rem; color: var(--text-muted);">${party}${ref}</td>
      <td>
        <button class="btn btn-secondary btn-sm view-transaction-btn" data-tx-id="${tx.id}" style="margin-right: 6px;">View Details</button>
        <button class="btn btn-danger btn-sm delete-transaction-btn" data-tx-id="${tx.id}" style="margin-right: 6px;">Delete</button>
        ${canReverse ? `<button class="btn btn-secondary btn-sm reverse-stock-btn" data-tx-id="${tx.id}" data-item-id="${tx.itemId || ''}" data-qty="${tx.quantity}" data-item-name="${(tx.itemName || '').replace(/"/g, '&quot;')}" data-supplier-name="${(tx.supplierName || '').replace(/"/g, '&quot;')}" data-reference-no="${(tx.referenceNo || '').replace(/"/g, '&quot;')}">Restock</button>` : '<span style="color: var(--text-dim); font-size: 0.8rem;">Locked</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });

  renderSupplierDailySummary();
}

async function renderSupplierDailySummary() {
  const supplierFilter = document.getElementById('rpt-supplier-summary-filter');
  const dateFilter = document.getElementById('rpt-daily-date-filter');
  const container = document.getElementById('invoice-detail-container');

  if (!supplierFilter || !dateFilter || !container) return;

  const supplierName = supplierFilter.value.trim();
  if (!supplierName || !dateFilter.value) {
    currentSupplierSummaryInvoice = null;
    container.innerHTML = '<div class="invoice-empty-state">Enter a supplier name and date to preview an invoice.</div>';
    return;
  }

  const summary = await getSupplierDailyStockInSummary({
    supplierName,
    date: dateFilter.value,
    transactions: allTransactionsCache,
  });

  if (!summary.length) {
    currentSupplierSummaryInvoice = null;
    container.innerHTML = '<div class="invoice-empty-state">No stock-in transactions were found for this supplier on the selected date.</div>';
    return;
  }

  const selectedRow = summary[0];
  currentInvoicePreview = null;
  currentSupplierSummaryInvoice = toSupplierInvoice(selectedRow);
  renderSupplierSummaryDetail(currentSupplierSummaryInvoice);
}

async function generateSupplierInvoice() {
  const supplierFilter = document.getElementById('rpt-supplier-summary-filter');
  const dateFilter = document.getElementById('rpt-daily-date-filter');
  const selectedSupplier = supplierFilter.value.trim();
  const selectedDate = dateFilter.value;

  if (!selectedSupplier || !selectedDate) {
    alert('Enter a supplier name and invoice date first.');
    return;
  }

  const summary = await getSupplierDailyStockInSummary({
    supplierName: selectedSupplier,
    date: selectedDate,
    transactions: allTransactionsCache,
  });

  if (!summary.length) {
    alert('No stock-in data found for the selected supplier and date.');
    return;
  }

  const selectedRow = summary[0];
  currentInvoicePreview = null;
  currentSupplierSummaryInvoice = toSupplierInvoice(selectedRow);

  document.getElementById('nav-invoices').click();
  renderSupplierSummaryDetail(currentSupplierSummaryInvoice);
}

function toSupplierInvoice(summary) {
  return {
    supplierName: summary.supplierName,
    date: summary.date,
    transactionCount: summary.transactionCount,
    totalQty: summary.totalQty,
    totalAmount: summary.totalAmount,
    items: summary.items,
  };
}

async function renderSupplierOverallSummary() {
  const supplierFilter = document.getElementById('rpt-supplier-summary-filter');
  const container = document.getElementById('supplier-overall-summary');
  if (!supplierFilter || !container) return;

  const supplierName = supplierFilter.value.trim();
  if (!supplierName) {
    container.innerHTML = '<div class="invoice-empty-state">Enter a supplier name to view all stock-in transactions across every day.</div>';
    return;
  }

  const summary = await getSupplierDailyStockInSummary({ supplierName, transactions: allTransactionsCache });
  if (!summary.length) {
    container.innerHTML = '<div class="invoice-empty-state">No stock-in transactions were found for this supplier.</div>';
    return;
  }

  const totalQty = summary.reduce((total, row) => total + row.totalQty, 0);
  const totalAmount = summary.reduce((total, row) => total + row.totalAmount, 0);
  const rows = summary.sort((a, b) => b.date.localeCompare(a.date)).map(row => `
    <tr>
      <td>${row.date}</td>
      <td>${row.items.map(item => `${item.itemName} (${item.quantity} pcs)`).join('<br>')}</td>
      <td>${row.totalQty} pcs</td>
      <td>${row.transactionCount}</td>
      <td>${formatCurrency(row.totalAmount)}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="supplier-history-summary">
      <span><strong>${summary.length}</strong> days</span>
      <span><strong>${totalQty}</strong> pieces received</span>
      <span><strong>${formatCurrency(totalAmount)}</strong> total received value</span>
    </div>
    <table class="data-table supplier-history-table">
      <thead><tr><th>Date</th><th>Items</th><th>Quantity</th><th>Entries</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function downloadSupplierHistory() {
  const supplierName = document.getElementById('rpt-supplier-summary-filter')?.value.trim();
  if (!supplierName) {
    alert('Enter a supplier name first.');
    return;
  }

  getSupplierDailyStockInSummary({ supplierName, transactions: allTransactionsCache }).then(summary => {
    if (!summary.length) {
      alert('No stock-in transactions were found for this supplier.');
      return;
    }
    printSupplierHistoryDocument(supplierName, summary);
  });
}

// Report 3: Stock Valuation Report
function renderReportValuation() {
  const tbody = document.getElementById('rpt-valuation-tbody');
  tbody.innerHTML = '';

  let grandCost = 0;
  let grandWholesale = 0;

  allItemsCache.forEach(item => {
    const pieces = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const totalCost = pieces * unitPrice;
    const totalWholesale = pieces * unitPrice;
    const profit = totalWholesale - totalCost;

    grandCost += totalCost;
    grandWholesale += totalWholesale;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 700;">${item.name}</td>
      <td style="font-size: 0.85rem;">${item.supplierName || 'General Supplier'}</td>
      <td style="font-weight: 800;">${pieces} pcs</td>
      <td>${formatCurrency(unitPrice)}</td>
      <td style="color: var(--accent-primary); font-weight: 600;">${formatCurrency(totalCost)}</td>
      <td style="font-weight: 600;">${formatCurrency(totalCost)}</td>
      <td style="font-weight: 700;">${formatCurrency(totalWholesale)}</td>
      <td style="color: var(--accent-success); font-weight: 700;">+${formatCurrency(profit)}</td>
    `;
    tbody.appendChild(tr);
  });

  const grandProfit = grandWholesale - grandCost;
  const marginPct = grandWholesale > 0 ? ((grandProfit / grandWholesale) * 100).toFixed(1) : 0;

  document.getElementById('val-total-cost').textContent = formatCurrency(grandCost);
  document.getElementById('val-total-wholesale').textContent = formatCurrency(grandWholesale);
  document.getElementById('val-total-margin').textContent = `+${formatCurrency(grandProfit)}`;
  document.getElementById('val-margin-percent').textContent = `${marginPct}% Estimated Gross Margin`;
}

// CSV Export Helpers
function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportStockCSV() {
  const exportData = allItemsCache.map(item => ({
    'Item Name': item.name,
    'Supplier': item.supplierName || 'General Supplier',
    'Available Stock (Pieces)': Number(item.quantity || 0),
    'Unit Price (LKR)': Number(item.unitPrice || 0),
    'Total Stock Value (LKR)': Number(item.totalValue || 0),
    'Description': item.description || ''
  }));

  const csv = Papa.unparse(exportData);
  downloadCSV(csv, `dress_stock_levels_${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportMovementCSV() {
  const exportData = allTransactionsCache.map(tx => ({
    'Date & Time': formatDate(tx.timestamp),
    'Type': tx.type,
    'Item Name': tx.itemName,
    'Quantity (Pieces)': tx.quantity,
    'Unit Price (LKR)': Number(tx.unitPrice || 0),
    'Total Amount (LKR)': Number(tx.totalAmount || 0),
    'Reason Code': tx.reasonCode,
    'Customer / Retailer': tx.customerName || 'N/A',
    'Supplier / Vendor': tx.supplierName || 'N/A',
    'Reference #': tx.referenceNo || 'N/A',
    'Notes': tx.notes || ''
  }));

  const csv = Papa.unparse(exportData);
  downloadCSV(csv, `stock_movement_log_${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportValuationCSV() {
  const exportData = allItemsCache.map(item => ({
    'Dress Item Name': item.name,
    'Supplier Name': item.supplierName,
    'Supplier Contact': item.supplierContact || '',
    'Total Stock (Pieces)': Number(item.quantity || 0),
    'Unit Purchase Cost (LKR)': Number(item.unitPrice || 0),
    'Total Inventory Cost Value (LKR)': Number(item.totalValue || 0),
    'Description': item.description || ''
  }));

  const csv = Papa.unparse(exportData);
  downloadCSV(csv, `stock_valuation_report_${new Date().toISOString().slice(0, 10)}.csv`);
}

// Data Backup & JSON Restore Handler
function setBackupStatus(message, isError = false) {
  const statusEl = document.getElementById('backup-sync-status');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? 'var(--accent-danger)' : 'var(--accent-success)';
}

function initDataBackupHandlers() {
  const exportBtn = document.getElementById('export-db-btn');
  const importInput = document.getElementById('import-db-input');
  const deviceNameInput = document.getElementById('device-name-input');

  exportBtn.addEventListener('click', async () => {
    const deviceName = (deviceNameInput?.value || '').trim() || 'Mobile Shop Phone';
    const jsonStr = await exportDatabaseJSON({ deviceName });
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deviceName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'shop'}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupStatus(`Backup saved for ${deviceName}`);
  });

  importInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          await importDatabaseJSON(evt.target.result);
          setBackupStatus(`Imported backup from ${file.name}`);
          alert('Database restored successfully from backup.');
          await refreshAllData();
        } catch (err) {
          setBackupStatus(`Import failed: ${err.message}`, true);
          alert(`Failed to import backup file: ${err.message}`);
        }
      };
      reader.readAsText(file);
    }
  });

  // Clear All Transaction Logs (from Data & Backup page)
  const clearLogsBtn = document.getElementById('clear-logs-btn');
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', clearAllLogs);
  }

  // Clear Logs button from Movement Log report view
  const clearLogsReportBtn = document.getElementById('clear-logs-report-btn');
  if (clearLogsReportBtn) {
    clearLogsReportBtn.addEventListener('click', clearAllLogs);
  }
}

async function clearAllLogs() {
  const count = allTransactionsCache.length;
  if (count === 0) {
    alert('No transaction logs to clear.');
    return;
  }
  if (confirm(`Are you sure you want to permanently delete all ${count} transaction log entries?\n\nNote: Your dress catalog and current stock levels will NOT be affected.`)) {
    try {
      await clearAllTransactions();
      await refreshAllData();
      alert(`✅ ${count} transaction log entries have been cleared successfully.`);
    } catch (err) {
      alert(`Failed to clear logs: ${err.message}`);
    }
  }
}

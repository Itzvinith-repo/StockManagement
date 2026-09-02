import { createIcons, icons } from 'lucide';
import Chart from 'chart.js/auto';
import Papa from 'papaparse';
import { 
  db, 
  getAllItems, 
  getItemById, 
  addDressItem, 
  updateDressItem, 
  deleteDressItem, 
  processStockIn, 
  processStockOut, 
  getAllTransactions, 
  updateTransactionSupplierAndDate,
  clearAllTransactions,
  recordStockCorrection,
  getSupplierDailyStockInSummary,
  exportDatabaseJSON, 
  importDatabaseJSON 
} from './db.js';

const APP_NAME = 'DressStock Shop';
const APP_VERSION = '1.0.0';

// Charts instances
let stockDistChart = null;
let movementChart = null;

// Application State
let currentTab = 'dashboard-tab';
let allItemsCache = [];
let allTransactionsCache = [];
let pendingStockInItemId = null;
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

// Global App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Client-ready app: do not auto-seed demo inventory data.
    // Users can import a backup or start adding live stock data from scratch.

    // 1. Attach navigation event listeners
    initNavigation();

    // 3. Attach Theme Toggle
    initTheme();

    // 4. Attach Modal & Form handlers
    initModalHandlers();
    initStockInForm();
    initStockOutForm();
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

      // Refresh view data
      await refreshAllData();

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
  allItemsCache = await getAllItems();
  allTransactionsCache = await getAllTransactions();

  populateItemDropdowns();
  renderDashboard();
  renderCatalogTable();
  renderReports();
  refreshIcons();
}

// Populate Item select boxes for Stock-In & Stock-Out
function populateItemDropdowns() {
  const stockInSelect = document.getElementById('stock-in-item');
  const stockOutSelect = document.getElementById('stock-out-item');
  const supplierFilter = document.getElementById('catalog-supplier-filter');

  const prevInVal = stockInSelect ? stockInSelect.value : '';
  const prevOutVal = stockOutSelect ? stockOutSelect.value : '';

  if (stockInSelect) {
    stockInSelect.innerHTML = '<option value="">-- Choose Item --</option>';
  }
  if (stockOutSelect) {
    stockOutSelect.innerHTML = '<option value="">-- Choose Item --</option>';
  }

  const suppliers = new Set();

  allItemsCache.forEach(item => {
    const stockQty = Number(item.quantity || 0);
    const optIn = document.createElement('option');
    optIn.value = item.id;
    optIn.textContent = `${item.name} (${stockQty} pcs in stock)`;
    stockInSelect && stockInSelect.appendChild(optIn);

    const optOut = document.createElement('option');
    optOut.value = item.id;
    optOut.textContent = `${item.name} (${stockQty} pcs in stock)`;
    stockOutSelect && stockOutSelect.appendChild(optOut);

    if (item.supplierName) suppliers.add(item.supplierName);
  });

  if (prevInVal && stockInSelect) stockInSelect.value = prevInVal;
  if (prevOutVal && stockOutSelect) stockOutSelect.value = prevOutVal;

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

  document.getElementById('stock-in-item').value = String(item.id);
  document.getElementById('stock-in-supplier').value = item.supplierName || '';
  document.getElementById('stock-in-unit-price').value = item.unitPrice || '';
  document.getElementById('stock-in-qty').focus();
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
  printInvoiceBtn.addEventListener('click', () => window.print());
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
  const itemSelect = document.getElementById('stock-in-item');
  const supplierInput = document.getElementById('stock-in-supplier');
  const qtyInput = document.getElementById('stock-in-qty');
  const unitPriceInput = document.getElementById('stock-in-unit-price');
  const totalAmountInput = document.getElementById('stock-in-total-amount');
  const invoiceNoInput = document.getElementById('stock-in-invoice-no');
  const generateInvoiceBtn = document.getElementById('stock-in-generate-invoice-btn');

  const updateStockInTotal = () => {
    const qty = Number(qtyInput.value) || 0;
    const unitPrice = Number(unitPriceInput.value) || 0;
    totalAmountInput.value = (qty * unitPrice).toFixed(2);
  };

  qtyInput.addEventListener('input', updateStockInTotal);
  unitPriceInput.addEventListener('input', updateStockInTotal);
  datetimeInput.value = getLocalDatetimeString();

  itemSelect.addEventListener('change', () => {
    const selectedId = itemSelect.value;
    if (selectedId) {
      const item = allItemsCache.find(i => i.id === Number(selectedId));
      if (item) {
        supplierInput.value = item.supplierName || '';
        if (item.unitPrice) {
          unitPriceInput.value = item.unitPrice;
        }
      }
    }
    updateStockInTotal();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = itemSelect.value;
    const timestamp = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();
    const supplierName = supplierInput.value.trim();
    const unitPrice = Number(unitPriceInput.value) || 0;
    const quantity = Number(qtyInput.value) || 0;
    const notes = document.getElementById('stock-in-notes').value.trim();
    const invoiceNo = invoiceNoInput.value.trim();

    if (!itemId || !supplierName || !quantity || !unitPrice) {
      alert('Please complete all required stock-in fields before submitting.');
      return;
    }

    try {
      await processStockIn({ itemId, timestamp, supplierName, unitPrice, quantity, referenceNo: invoiceNo, notes, reasonCode: 'Stock Receiving' });
      alert(`Stock-In Logged Successfully! Added +${quantity} pcs.`);
      form.reset();
      datetimeInput.value = getLocalDatetimeString();
      await refreshAllData();
    } catch (err) {
      alert(`Failed to log Stock-In: ${err.message}`);
    }
  });

  generateInvoiceBtn.addEventListener('click', () => {
    const itemId = itemSelect.value;
    const selectedItem = allItemsCache.find(i => i.id === Number(itemId));
    if (!itemId || !selectedItem) {
      alert('Please choose a dress item before generating an invoice.');
      return;
    }

    const quantity = Number(qtyInput.value) || 0;
    const unitPrice = Number(unitPriceInput.value) || 0;
    const totalAmount = quantity * unitPrice;
    const supplier = supplierInput.value.trim() || 'Supplier';
    const referenceNo = invoiceNoInput.value.trim() || 'N/A';
    const timestamp = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();

    currentInvoicePreview = {
      id: Date.now(),
      type: 'IN',
      itemName: selectedItem.name,
      itemId: Number(itemId),
      supplierName: supplier,
      customerName: '',
      quantity,
      unitPrice,
      totalAmount,
      referenceNo,
      reasonCode: 'Stock Receiving',
      notes: document.getElementById('stock-in-notes').value.trim(),
      description: 'Item received into stock / inventory',
      timestamp
    };
    currentSupplierSummaryInvoice = null;

    document.getElementById('nav-invoices').click();
    renderInvoiceDetail(currentInvoicePreview);
  });
}

// Stock-Out Form Handler
function initStockOutForm() {
  const form = document.getElementById('stock-out-form');
  const datetimeInput = document.getElementById('stock-out-datetime');
  const itemSelect = document.getElementById('stock-out-item');
  const qtyInput = document.getElementById('stock-out-qty');
  const unitPriceInput = document.getElementById('stock-out-unit-price');
  const totalAmountInput = document.getElementById('stock-out-total-amount');
  const customerInput = document.getElementById('stock-out-customer');
  const refInput = document.getElementById('stock-out-ref');
  const generateInvoiceBtn = document.getElementById('stock-out-generate-invoice-btn');

  const updateStockOutTotal = () => {
    const qty = Number(qtyInput.value) || 0;
    const unitPrice = Number(unitPriceInput.value) || 0;
    totalAmountInput.value = (qty * unitPrice).toFixed(2);
  };

  qtyInput.addEventListener('input', updateStockOutTotal);
  unitPriceInput.addEventListener('input', updateStockOutTotal);
  datetimeInput.value = getLocalDatetimeString();

  itemSelect.addEventListener('change', () => {
    const selectedId = itemSelect.value;
    if (selectedId) {
      const item = allItemsCache.find(i => i.id === Number(selectedId));
      if (item) {
        if (item.unitPrice) {
          unitPriceInput.value = item.unitPrice;
        }
      }
    }
    updateStockOutTotal();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = itemSelect.value;
    const timestamp = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();
    const customerName = customerInput.value.trim();
    const referenceNo = refInput.value.trim();
    const quantity = Number(qtyInput.value) || 0;
    const unitPrice = Number(unitPriceInput.value) || 0;
    const reasonCode = document.getElementById('stock-out-reason').value;
    const notes = document.getElementById('stock-out-notes').value.trim();

    if (!itemId || !quantity || !unitPrice) {
      alert('Please complete all required stock-out fields before submitting.');
      return;
    }

    try {
      await processStockOut({ itemId, timestamp, customerName, referenceNo, quantity, unitPrice, reasonCode, notes });
      alert(`Stock-Out Logged Successfully! Deducted ${quantity} pcs.`);
      form.reset();
      datetimeInput.value = getLocalDatetimeString();
      await refreshAllData();
    } catch (err) {
      alert(`Stock-Out Error: ${err.message}`);
    }
  });

  generateInvoiceBtn.addEventListener('click', () => {
    const itemId = itemSelect.value;
    const selectedItem = allItemsCache.find(i => i.id === Number(itemId));
    if (!itemId || !selectedItem) {
      alert('Please choose a dress item before generating an invoice.');
      return;
    }

    const quantity = Number(qtyInput.value) || 0;
    const unitPrice = Number(unitPriceInput.value) || 0;
    const totalAmount = quantity * unitPrice;
    const partyName = customerInput.value.trim() || 'Customer';
    const referenceNo = refInput.value.trim() || 'N/A';
    const timestamp = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();

    currentInvoicePreview = {
      id: Date.now(),
      type: 'OUT',
      itemName: selectedItem.name,
      itemId: Number(itemId),
      supplierName: '',
      customerName: partyName,
      quantity,
      unitPrice,
      totalAmount,
      referenceNo,
      reasonCode: document.getElementById('stock-out-reason').value,
      notes: document.getElementById('stock-out-notes').value.trim(),
      description: 'Item sold or removed from inventory',
      timestamp
    };
    currentSupplierSummaryInvoice = null;

    document.getElementById('nav-invoices').click();
    renderInvoiceDetail(currentInvoicePreview);
  });
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
function openInvoiceModal({ type, title, itemName, partyName, referenceNo, quantity, unitPrice, totalAmount, date, notes, description }) {
  const modal = document.getElementById('invoice-modal');
  const content = document.getElementById('invoice-content');
  const invoiceDate = date ? new Date(date) : new Date();
  const formattedDate = invoiceDate.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

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
        <div><div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim);">Item</div><div style="font-weight: 700; margin-top: 4px;">${itemName}</div></div>
        <div><div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim);">Reference</div><div style="font-weight: 700; margin-top: 4px;">${referenceNo}</div></div>
        <div><div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim);">${type === 'IN' ? 'Supplier' : 'Customer'}</div><div style="font-weight: 700; margin-top: 4px;">${partyName}</div></div>
        <div><div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim);">Status</div><div style="font-weight: 700; margin-top: 4px;">${type === 'IN' ? 'In Stock' : 'Out of Stock'}</div></div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <thead>
          <tr style="background: rgba(99, 102, 241, 0.08);">
            <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color);">Description</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Qty</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Unit Price</th>
            <th style="padding: 10px 12px; text-align: right; border-bottom: 1px solid var(--border-color);">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid var(--border-color);">${description}</td>
            <td style="padding: 12px; text-align: right; border-bottom: 1px solid var(--border-color);">${quantity}</td>
            <td style="padding: 12px; text-align: right; border-bottom: 1px solid var(--border-color);">${formatCurrency(unitPrice)}</td>
            <td style="padding: 12px; text-align: right; border-bottom: 1px solid var(--border-color); font-weight: 700;">${formatCurrency(totalAmount)}</td>
          </tr>
        </tbody>
      </table>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 18px;">
        <div style="color: var(--text-muted); font-size: 0.82rem;">${notes || 'No notes added.'}</div>
        <div style="font-size: 1.2rem; font-weight: 800;">Total: ${formatCurrency(totalAmount)}</div>
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
  const itemRows = `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${tx.itemName || 'Dress Item'}</td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid var(--border-color);">${tx.quantity} pcs</td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid var(--border-color);">${formatCurrency(Number(tx.unitPrice || 0))}</td>
      <td style="padding: 10px; text-align: right; border-bottom: 1px solid var(--border-color); font-weight: 700;">${formatCurrency(Number(tx.totalAmount || 0))}</td>
    </tr>
  `;

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
        <div style="font-size: 1.2rem; font-weight: 800;">Total: ${formatCurrency(Number(tx.totalAmount || 0))}</div>
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
  return `
    <div style="font-family: Arial, sans-serif; color: #111; padding: 20px;">
      <h2 style="margin: 0 0 8px;">DressStock Shop</h2>
      <div style="font-size: 12px; margin-bottom: 14px;">${invoice.type === 'IN' ? 'Stock-In Invoice' : 'Stock-Out Invoice'} • ${new Date(invoice.timestamp).toLocaleString()}</div>
      <div style="margin-bottom: 12px;"><strong>Item:</strong> ${invoice.itemName}</div>
      <div style="margin-bottom: 12px;"><strong>${invoice.type === 'IN' ? 'Supplier' : 'Customer'}:</strong> ${invoice.type === 'IN' ? (invoice.supplierName || 'Supplier') : (invoice.customerName || 'Customer')}</div>
      <div style="margin-bottom: 12px;"><strong>Reference:</strong> ${invoice.referenceNo || 'N/A'}</div>
      <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
        <tr><th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Qty</th><th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Unit Price</th><th style="border: 1px solid #ccc; padding: 8px; text-align: left;">Total</th></tr>
        <tr><td style="border: 1px solid #ccc; padding: 8px;">${invoice.quantity}</td><td style="border: 1px solid #ccc; padding: 8px;">${formatCurrency(Number(invoice.unitPrice || 0))}</td><td style="border: 1px solid #ccc; padding: 8px;">${formatCurrency(Number(invoice.totalAmount || 0))}</td></tr>
      </table>
      <div style="margin-top: 12px; font-weight: 700; text-align: right;">Total: ${formatCurrency(Number(invoice.totalAmount || 0))}</div>
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
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    alert('Please allow pop-ups to download the invoice as PDF.');
    return;
  }
  printWindow.document.write(`<!doctype html><html><head><title>${title}</title><meta charset="utf-8"><style>${printDocumentStyles()}</style></head><body>${content}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.addEventListener('load', () => printWindow.print());
}

function printDocumentStyles() {
  return `@page { size: A4; margin: 16mm; } * { box-sizing: border-box; } body { margin: 0; color: #172033; font: 13px Arial, sans-serif; } .print-invoice { width: 100%; } .print-invoice-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e3a5f; padding-bottom: 22px; margin-bottom: 28px; } h1 { margin: 4px 0; font-size: 28px; letter-spacing: .02em; } p { margin: 0; color: #64748b; } .print-kicker { color: #1e3a5f; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; } .print-meta { display: grid; gap: 5px; text-align: right; font-size: 14px; } .print-meta span { color: #64748b; } table { width: 100%; border-collapse: collapse; } th { background: #e8eef5; color: #233a56; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; } th, td { border-bottom: 1px solid #d9e0e8; padding: 11px 9px; text-align: left; } td:nth-child(3), td:nth-child(4), td:nth-child(5), th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: right; } .print-invoice-total { display: flex; justify-content: space-between; border-top: 2px solid #1e3a5f; margin-top: 22px; padding-top: 16px; font-size: 15px; } .print-invoice-total strong { font-size: 20px; }`;
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

  const summary = await getSupplierDailyStockInSummary({ supplierName });
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

  getSupplierDailyStockInSummary({ supplierName }).then(summary => {
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

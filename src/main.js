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
    'catalog-tab': { title: 'Dress Catalog & Master Profiles', desc: 'Manage dress items, supplier information, wholesale prices, and size/color variants.' },
    'stock-in-tab': { title: 'Stock-In Management (Receiving Goods)', desc: 'Record incoming dress shipments, update unit purchase prices, and auto-update inventory.' },
    'stock-out-tab': { title: 'Stock-Out Management (Sales & Reductions)', desc: 'Log sales, damaged garments, or vendor returns with reference numbers and reason codes.' },
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

  const prevInVal = stockInSelect.value;
  const prevOutVal = stockOutSelect.value;

  stockInSelect.innerHTML = '<option value="">-- Choose Item --</option>';
  stockOutSelect.innerHTML = '<option value="">-- Choose Item --</option>';

  const suppliers = new Set();

  allItemsCache.forEach(item => {
    const optIn = document.createElement('option');
    optIn.value = item.id;
    optIn.textContent = `${item.name} (${item.totalStock} pcs in stock)`;
    stockInSelect.appendChild(optIn);

    const optOut = document.createElement('option');
    optOut.value = item.id;
    optOut.textContent = `${item.name} (${item.totalStock} pcs in stock)`;
    stockOutSelect.appendChild(optOut);

    if (item.supplierName) suppliers.add(item.supplierName);
  });

  if (prevInVal) stockInSelect.value = prevInVal;
  if (prevOutVal) stockOutSelect.value = prevOutVal;

  // Supplier filter options
  supplierFilter.innerHTML = '<option value="">All Suppliers</option>';
  suppliers.forEach(sup => {
    const opt = document.createElement('option');
    opt.value = sup;
    opt.textContent = sup;
    supplierFilter.appendChild(opt);
  });
}

// Render Dashboard Metrics & Charts
function renderDashboard() {
  let totalItemsCount = allItemsCache.length;
  let totalPiecesCount = 0;
  let totalCostValuation = 0;
  let totalWholesaleValuation = 0;

  allItemsCache.forEach(item => {
    const itemPieces = item.totalStock || 0;
    totalPiecesCount += itemPieces;
    totalCostValuation += itemPieces * (item.unitCost || 0);
    totalWholesaleValuation += itemPieces * (item.wholesalePrice || 0);
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
        <td><span class="variant-pill">${tx.size} / ${tx.color}</span></td>
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
    const data = allItemsCache.map(i => i.totalStock);
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
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 24px;">No dress items found matching criteria.</td></tr>';
    return;
  }

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    
    // Render variants breakdown
    const variantHTML = (item.variants || []).map(v => 
      `<span class="variant-pill">${v.size} / ${v.color}: <span class="qty">${v.stockQuantity} pcs</span></span>`
    ).join(' ');

    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">${item.name}</div>
        <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 2px;">${item.description || 'No description'}</div>
      </td>
      <td>
        <div style="font-weight: 600; font-size: 0.875rem;">${item.supplierName}</div>
        <div style="font-size: 0.775rem; color: var(--text-muted);">${item.supplierContact || ''}</div>
      </td>
      <td style="font-weight: 600;">${formatCurrency(item.unitCost)}</td>
      <td style="font-weight: 700; color: var(--accent-primary);">${formatCurrency(item.wholesalePrice)}</td>
      <td><div class="variant-pills">${variantHTML || '<span style="color: var(--text-dim);">No variants</span>'}</div></td>
      <td style="font-weight: 800; font-size: 1rem;">${item.totalStock} pcs</td>
      <td>
        <div style="display: flex; gap: 8px;">
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
    const editBtn = e.target.closest('.edit-dress-btn');
    const deleteBtn = e.target.closest('.delete-dress-btn');

    if (editBtn) {
      openDressModal(editBtn.getAttribute('data-id'));
      return;
    }

    if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-id');
      const item = allItemsCache.find(i => i.id === Number(id));
      if (!item) return;
      if (confirm(`Are you sure you want to delete "${item.name}" and all its variant stock records? This cannot be undone.`)) {
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

// Catalog Search / Filter Listeners
document.getElementById('catalog-search').addEventListener('input', renderCatalogTable);
document.getElementById('catalog-supplier-filter').addEventListener('change', renderCatalogTable);

// Modal Add / Edit Dress Item Handlers
function initModalHandlers() {
  const modal = document.getElementById('dress-modal');
  const addBtn = document.getElementById('add-new-dress-btn');
  const closeBtn = document.getElementById('dress-modal-close');
  const cancelBtn = document.getElementById('dress-modal-cancel');
  const addVariantRowBtn = document.getElementById('add-variant-row-btn');
  const form = document.getElementById('dress-item-form');

  addBtn.addEventListener('click', () => openDressModal(null));
  closeBtn.addEventListener('click', closeDressModal);
  cancelBtn.addEventListener('click', closeDressModal);

  addVariantRowBtn.addEventListener('click', () => {
    appendVariantRow();
    refreshIcons();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('dress-id').value;
    const name = document.getElementById('dress-name').value.trim();
    const description = document.getElementById('dress-desc').value.trim();
    const supplierName = document.getElementById('dress-supplier-name').value.trim();
    const supplierContact = document.getElementById('dress-supplier-contact').value.trim();
    const unitCost = parseFloat(document.getElementById('dress-cost').value);
    const wholesalePrice = parseFloat(document.getElementById('dress-wholesale-price').value);

    // Collect variants
    const variantRows = document.querySelectorAll('.variant-builder-row');
    const variants = [];
    variantRows.forEach(row => {
      const size = row.querySelector('.var-size').value;
      const color = row.querySelector('.var-color').value.trim();
      const quantity = parseInt(row.querySelector('.var-qty').value) || 0;
      if (size && color) {
        variants.push({ size, color, quantity });
      }
    });

    const itemData = { name, description, supplierName, supplierContact, unitCost, wholesalePrice, variants };

    try {
      if (id) {
        await updateDressItem(id, itemData);
      } else {
        await addDressItem(itemData, variants);
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
  const variantContainer = document.getElementById('variant-builder-container');

  form.reset();
  variantContainer.innerHTML = '';
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
      document.getElementById('dress-cost').value = item.unitCost;
      document.getElementById('dress-wholesale-price').value = item.wholesalePrice;

      if (item.variants && item.variants.length > 0) {
        item.variants.forEach(v => appendVariantRow(v.size, v.color, v.stockQuantity));
      } else {
        appendVariantRow();
      }
    }
  } else {
    titleEl.textContent = 'Add New Dress Item';
    // Add default initial variant row
    appendVariantRow('M', 'Standard', 10);
  }

  modal.classList.add('active');
  refreshIcons();
}

function closeDressModal() {
  document.getElementById('dress-modal').classList.remove('active');
}

function appendVariantRow(size = 'M', color = '', qty = 0) {
  const container = document.getElementById('variant-builder-container');
  const row = document.createElement('div');
  row.className = 'variant-builder-row';
  row.innerHTML = `
    <select class="form-control form-control-simple var-size" style="max-width: 110px;">
      <option value="XS" ${size === 'XS' ? 'selected' : ''}>XS</option>
      <option value="S" ${size === 'S' ? 'selected' : ''}>S</option>
      <option value="M" ${size === 'M' ? 'selected' : ''}>M</option>
      <option value="L" ${size === 'L' ? 'selected' : ''}>L</option>
      <option value="XL" ${size === 'XL' ? 'selected' : ''}>XL</option>
      <option value="XXL" ${size === 'XXL' ? 'selected' : ''}>XXL</option>
      <option value="Free Size" ${size === 'Free Size' ? 'selected' : ''}>Free Size</option>
    </select>
    <input type="text" class="form-control form-control-simple var-color" placeholder="Color (e.g. Royal Blue)" value="${color}" required>
    <input type="number" min="0" class="form-control form-control-simple var-qty" placeholder="Qty" value="${qty}" style="max-width: 100px;" required>
    <button type="button" class="btn btn-danger btn-icon remove-var-btn"><i data-lucide="minus"></i></button>
  `;

  row.querySelector('.remove-var-btn').addEventListener('click', () => {
    if (container.children.length > 1) {
      row.remove();
    } else {
      alert('At least one size/color variant is required.');
    }
  });

  container.appendChild(row);
}

// Stock-In Form Handler
function initStockInForm() {
  const form = document.getElementById('stock-in-form');
  const datetimeInput = document.getElementById('stock-in-datetime');
  const itemSelect = document.getElementById('stock-in-item');
  const costInput = document.getElementById('stock-in-cost');
  const supplierInput = document.getElementById('stock-in-supplier');

  datetimeInput.value = getLocalDatetimeString();

  itemSelect.addEventListener('change', () => {
    const selectedId = itemSelect.value;
    if (selectedId) {
      const item = allItemsCache.find(i => i.id === Number(selectedId));
      if (item) {
        costInput.value = item.unitCost;
        supplierInput.value = item.supplierName || '';
      }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = itemSelect.value;
    const timestamp = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();
    const supplierName = supplierInput.value.trim();
    const unitCost = parseFloat(costInput.value);
    const size = document.getElementById('stock-in-size').value;
    const color = document.getElementById('stock-in-color').value.trim();
    const quantity = parseInt(document.getElementById('stock-in-qty').value);
    const notes = document.getElementById('stock-in-notes').value.trim();

    try {
      await processStockIn({ itemId, timestamp, supplierName, unitCost, size, color, quantity, notes });
      alert(`Stock-In Logged Successfully! Added +${quantity} pcs of ${size}/${color}.`);
      form.reset();
      datetimeInput.value = getLocalDatetimeString();
      await refreshAllData();
    } catch (err) {
      alert(`Failed to log Stock-In: ${err.message}`);
    }
  });
}

// Stock-Out Form Handler
function initStockOutForm() {
  const form = document.getElementById('stock-out-form');
  const datetimeInput = document.getElementById('stock-out-datetime');
  const itemSelect = document.getElementById('stock-out-item');
  const variantSelect = document.getElementById('stock-out-variant');

  datetimeInput.value = getLocalDatetimeString();

  itemSelect.addEventListener('change', () => {
    const selectedId = itemSelect.value;
    variantSelect.innerHTML = '<option value="">-- Select Variant --</option>';

    if (selectedId) {
      const item = allItemsCache.find(i => i.id === Number(selectedId));
      if (item && item.variants) {
        item.variants.forEach(v => {
          const opt = document.createElement('option');
          opt.value = `${v.size}|${v.color}`;
          opt.textContent = `${v.size} / ${v.color} (${v.stockQuantity} pcs available)`;
          variantSelect.appendChild(opt);
        });
      }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemId = itemSelect.value;
    const timestamp = datetimeInput.value ? new Date(datetimeInput.value).toISOString() : new Date().toISOString();
    const customerName = document.getElementById('stock-out-customer').value.trim();
    const referenceNo = document.getElementById('stock-out-ref').value.trim();
    const variantVal = variantSelect.value;
    const quantity = parseInt(document.getElementById('stock-out-qty').value);
    const reasonCode = document.getElementById('stock-out-reason').value;
    const notes = document.getElementById('stock-out-notes').value.trim();

    if (!variantVal) {
      alert('Please select a valid size/color variant.');
      return;
    }

    const [size, color] = variantVal.split('|');

    try {
      await processStockOut({ itemId, timestamp, customerName, referenceNo, size, color, quantity, reasonCode, notes });
      alert(`Stock-Out Logged Successfully! Deducted ${quantity} pcs (${size}/${color}).`);
      form.reset();
      datetimeInput.value = getLocalDatetimeString();
      await refreshAllData();
    } catch (err) {
      alert(`Stock-Out Error: ${err.message}`);
    }
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
  document.getElementById('rpt-stock-size-filter').addEventListener('change', renderReportStock);
  document.getElementById('rpt-stock-status-filter').addEventListener('change', renderReportStock);

  document.getElementById('rpt-movement-search').addEventListener('input', renderReportMovement);
  document.getElementById('rpt-movement-type-filter').addEventListener('change', renderReportMovement);
  document.getElementById('rpt-movement-reason-filter').addEventListener('change', renderReportMovement);

  // CSV Export Listeners
  document.getElementById('export-stock-csv').addEventListener('click', exportStockCSV);
  document.getElementById('export-movement-csv').addEventListener('click', exportMovementCSV);
  document.getElementById('export-valuation-csv').addEventListener('click', exportValuationCSV);
}

function renderReports() {
  renderReportStock();
  renderReportMovement();
  renderReportValuation();
}

// Report 1: Real-Time Current Stock Level
function renderReportStock() {
  const tbody = document.getElementById('rpt-stock-tbody');
  const searchVal = document.getElementById('rpt-stock-search').value.toLowerCase();
  const sizeVal = document.getElementById('rpt-stock-size-filter').value;
  const statusVal = document.getElementById('rpt-stock-status-filter').value;

  tbody.innerHTML = '';
  const rows = [];

  allItemsCache.forEach(item => {
    (item.variants || []).forEach(v => {
      const matchesSearch = item.name.toLowerCase().includes(searchVal) || v.color.toLowerCase().includes(searchVal);
      const matchesSize = !sizeVal || v.size === sizeVal;
      
      let matchesStatus = true;
      if (statusVal === 'in_stock') matchesStatus = v.stockQuantity > 0;
      if (statusVal === 'low_stock') matchesStatus = v.stockQuantity > 0 && v.stockQuantity <= 15;
      if (statusVal === 'out_of_stock') matchesStatus = v.stockQuantity === 0;

      if (matchesSearch && matchesSize && matchesStatus) {
        rows.push({
          name: item.name,
          size: v.size,
          color: v.color,
          stockQuantity: v.stockQuantity,
          unitCost: item.unitCost,
          wholesalePrice: item.wholesalePrice,
          subtotalCost: v.stockQuantity * item.unitCost,
          subtotalWholesale: v.stockQuantity * item.wholesalePrice
        });
      }
    });
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 24px;">No variant stock records match filters.</td></tr>';
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');
    let statusBadge = `<span class="badge badge-in">In Stock</span>`;
    if (r.stockQuantity === 0) statusBadge = `<span class="badge badge-out">Out of Stock</span>`;
    else if (r.stockQuantity <= 15) statusBadge = `<span class="badge badge-warning">Low Stock</span>`;

    tr.innerHTML = `
      <td style="font-weight: 600;">${r.name}</td>
      <td><span class="variant-pill">${r.size}</span></td>
      <td>${r.color}</td>
      <td style="font-weight: 800;">${r.stockQuantity} pcs</td>
      <td>${formatCurrency(r.unitCost)}</td>
      <td style="color: var(--accent-primary); font-weight: 600;">${formatCurrency(r.wholesalePrice)}</td>
      <td>${formatCurrency(r.subtotalCost)}</td>
      <td>${formatCurrency(r.subtotalWholesale)}</td>
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
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 24px;">No movement transactions found.</td></tr>';
    return;
  }

  filtered.forEach(tx => {
    const tr = document.createElement('tr');
    const badgeClass = tx.type === 'IN' ? 'badge-in' : 'badge-out';
    const badgeText = tx.type === 'IN' ? 'Stock-In' : 'Stock-Out';
    const party = tx.type === 'IN' ? (tx.supplierName || 'N/A') : (tx.customerName || 'N/A');
    const ref = tx.referenceNo && tx.referenceNo !== 'N/A' ? ` (Ref: ${tx.referenceNo})` : '';

    tr.innerHTML = `
      <td style="font-size: 0.825rem; color: var(--text-muted);">${formatDate(tx.timestamp)}</td>
      <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      <td style="font-weight: 600;">${tx.itemName}</td>
      <td><span class="variant-pill">${tx.size} / ${tx.color}</span></td>
      <td style="font-weight: 800;">${tx.type === 'IN' ? '+' : '-'}${tx.quantity} pcs</td>
      <td>${formatCurrency(tx.unitCost)}</td>
      <td>${formatCurrency(tx.wholesalePrice)}</td>
      <td style="font-size: 0.85rem;">${tx.reasonCode}</td>
      <td style="font-size: 0.85rem; color: var(--text-muted);">${party}${ref}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Report 3: Stock Valuation Report
function renderReportValuation() {
  const tbody = document.getElementById('rpt-valuation-tbody');
  tbody.innerHTML = '';

  let grandCost = 0;
  let grandWholesale = 0;

  allItemsCache.forEach(item => {
    const pieces = item.totalStock || 0;
    const totalCost = pieces * item.unitCost;
    const totalWholesale = pieces * item.wholesalePrice;
    const profit = totalWholesale - totalCost;

    grandCost += totalCost;
    grandWholesale += totalWholesale;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 700;">${item.name}</td>
      <td style="font-size: 0.85rem;">${item.supplierName}</td>
      <td style="font-weight: 800;">${pieces} pcs</td>
      <td>${formatCurrency(item.unitCost)}</td>
      <td style="color: var(--accent-primary); font-weight: 600;">${formatCurrency(item.wholesalePrice)}</td>
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
  const exportData = [];
  allItemsCache.forEach(item => {
    (item.variants || []).forEach(v => {
      exportData.push({
        'Item Name': item.name,
        'Supplier': item.supplierName,
        'Size': v.size,
        'Color': v.color,
        'Available Stock (Pieces)': v.stockQuantity,
        'Unit Cost ($)': item.unitCost,
        'Wholesale Price ($)': item.wholesalePrice,
        'Subtotal Cost ($)': v.stockQuantity * item.unitCost,
        'Subtotal Wholesale ($)': v.stockQuantity * item.wholesalePrice
      });
    });
  });

  const csv = Papa.unparse(exportData);
  downloadCSV(csv, `dress_stock_levels_${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportMovementCSV() {
  const exportData = allTransactionsCache.map(tx => ({
    'Date & Time': formatDate(tx.timestamp),
    'Type': tx.type,
    'Item Name': tx.itemName,
    'Size': tx.size,
    'Color': tx.color,
    'Quantity (Pieces)': tx.quantity,
    'Unit Cost ($)': tx.unitCost,
    'Wholesale Price ($)': tx.wholesalePrice,
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
    'Total Stock (Pieces)': item.totalStock,
    'Unit Purchase Cost ($)': item.unitCost,
    'Wholesale Selling Price ($)': item.wholesalePrice,
    'Total Inventory Cost Value ($)': item.totalStock * item.unitCost,
    'Total Wholesale Sales Potential ($)': item.totalStock * item.wholesalePrice,
    'Projected Profit ($)': (item.totalStock * item.wholesalePrice) - (item.totalStock * item.unitCost)
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
      await db.transactions.clear();
      await refreshAllData();
      alert(`✅ ${count} transaction log entries have been cleared successfully.`);
    } catch (err) {
      alert(`Failed to clear logs: ${err.message}`);
    }
  }
}

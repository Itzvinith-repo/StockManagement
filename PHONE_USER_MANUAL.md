# Phone User Manual - DressStock Shop

This manual explains how to use the DressStock Shop stock management system from a phone.

## 1) Opening the app

Use the permanent client URL supplied by the project owner. Save it in the phone browser bookmarks or add it to the home screen.

The recommended setup is:

- Phone connected to mobile data or Wi-Fi
- Hosted app URL opened in Chrome or Safari
- Supabase used automatically for shared shop data

The shop computer does not need to remain switched on after the app has been deployed to its hosting service. Do not use a temporary `trycloudflare.com` URL for normal daily work.

## 2) Main menu

On a phone, tap the menu button at the top-left to open navigation. Choose:

- **Dashboard**: view total items, pieces, stock value, and recent activity
- **Dress Catalog**: add, edit, or delete dress item profiles
- **Stock-In**: record goods received from a supplier
- **Stock-Out**: record sales, damaged items, or returns to a supplier
- **Reports & Analytics**: search stock, transactions, and valuation
- **Data & Backup**: export a backup file or import an earlier backup

After choosing a menu item, the drawer closes automatically. If it stays open, tap outside the drawer.

## 3) Add a new dress item

Use this once for each dress profile.

1. Open **Dress Catalog**.
2. Tap **Add New Dress Item**.
3. Enter the dress name.
4. Enter the supplier name and contact details.
5. Enter the purchase/unit cost and wholesale selling price.
6. Add each size and color variant with its starting quantity.
7. Tap **Save Item**.

The item will appear in the catalog and in the Stock-In and Stock-Out selection lists.

## 4) Record Stock-In

Use Stock-In when new goods arrive.

1. Open **Stock-In**.
2. Select the dress item.
3. Confirm or enter the supplier and purchase cost.
4. Select the size.
5. Enter the color or variant name.
6. Enter the quantity received in pieces.
7. Add an invoice number or delivery note in the notes field if available.
8. Tap **Submit Stock-In**.

The stock quantity and dashboard totals update after the entry is saved.

## 5) Record Stock-Out

Use Stock-Out whenever stock leaves the shop.

1. Open **Stock-Out**.
2. Select the dress item and variant.
3. Enter the quantity removed.
4. Select the reason, such as wholesale sale, damaged item, or supplier return.
5. Enter the customer, supplier, invoice, or reference details when applicable.
6. Add notes if needed.
7. Tap **Submit Stock-Out**.

Do not record a quantity greater than the available stock. Check the dashboard or current stock report first when unsure.

## 6) Check stock and reports

### Dashboard

The Dashboard shows the current total dress profiles, total pieces, purchase value, wholesale value, charts, and recent movements.

### Current Stock Report

Open **Reports & Analytics**, then choose the current stock view. Search by item name and filter by size or stock status.

### Movement Report

Use the movement view to find Stock-In and Stock-Out history. Search by item, invoice, customer, supplier, or reference number. Use the filters to show only Stock-In or Stock-Out entries.

### Valuation Report

Use the valuation view to review purchase cost, estimated wholesale value, and projected gross profit.

## 7) Shared data on multiple phones

When the app is opened through the hosted client URL, entries are saved in the shared Supabase database. This means approved devices can see the same catalog, stock quantities, and transaction history.

After saving an entry, allow the success message to appear before closing the browser. If another device does not show the latest entry, refresh the page and check the internet connection.

## 8) Backup and device transfer

Supabase is the main shared storage. Backups are still recommended before major changes or when changing devices.

1. Open **Data & Backup**.
2. Leave the device name, or enter a clear name such as `Shop Phone`.
3. Tap **Export Backup**.
4. Save the JSON file to Google Drive, email, or another safe location.

To restore a backup:

1. Open **Data & Backup**.
2. Tap **Select Backup File**.
3. Choose the saved JSON backup.
4. Confirm the import if prompted.
5. Refresh the app and check the Dashboard.

Do not import an old backup unless you intend to restore its data. An old file may replace newer records.

## 9) Daily working method

1. Open the permanent app URL.
2. Check the Dashboard for the current stock position.
3. Add new dress profiles when a product is not already in the catalog.
4. Record every delivery using Stock-In.
5. Record every sale, damage, or return using Stock-Out.
6. Review the Movement Report at the end of the day.
7. Export a backup regularly and keep it in cloud storage.

## 10) If something does not work

- Make sure the phone has internet access.
- Refresh the page once.
- Check that the correct hosted URL is being used.
- Make sure all required fields are completed.
- If a save fails, do not repeatedly submit it. Check whether the record was saved in the Dashboard or Movement Report first.
- Contact the project owner if the problem continues, including the item name and the action attempted.

## 11) Important safety rules

- Use only the approved client URL.
- Do not share database keys or project settings.
- Keep regular JSON backups in a secure cloud location.
- Confirm quantities before saving Stock-In or Stock-Out.
- Do not use an old backup to overwrite current shared data without checking it first.
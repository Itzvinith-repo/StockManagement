# Phone User Manual for Stock Management System

This app is made for real shop use on a mobile phone.

## 1) What this app does

Use this app to:
- add dress items and catalog products
- record stock received (Stock-In)
- record stock sold or removed (Stock-Out)
- check dashboard and stock reports
- export backup files for later laptop use

## 2) Use on the phone in the shop

### Option A: Same Wi-Fi network
If the phone and the computer are on the same Wi-Fi, open the app using the computer's local address.

Example:
- http://192.168.1.10:5173

This is simple and works well if both devices are in the same place.

### Option B: Different network / different ISP / different location
If the phone is on a different network, use Cloudflare Tunnel.

This is the best free way to use the app remotely without typing a local IP address.

## 3) How Cloudflare works

Cloudflare Tunnel creates a secure public link to your local app.

Flow:
1. The shop computer runs the app locally.
2. Cloudflare connects to that local app.
3. The phone opens the Cloudflare link in the browser.
4. The phone can use the app even though it is on another internet network.

This means:
- you do not need to type a local IP address in the phone
- you do not need the phone to be on the same Wi-Fi
- the app can be used from another location, as long as the computer in the shop is ON and connected to the internet

## 4) Steps to use Cloudflare for free

### On the shop computer
1. Open the project folder in terminal.
2. Run:
   ```bash
   npm install
   npm run dev -- --host 0.0.0.0
   ```
3. Keep this terminal open while the app is running.

### Install Cloudflare Tunnel
4. Install Cloudflare Tunnel on the same computer.
5. Run:
   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```
6. Cloudflare will give you a public URL, such as:
   ```text
   https://something.trycloudflare.com
   ```

### On the mobile phone
7. Open the Cloudflare URL in the browser.
8. Use the app normally.

## 5) Can I use it on mobile with a different ISP?

Yes.

If the app is exposed through Cloudflare Tunnel, the phone can use it from a different ISP, different household internet, or different location.

This works because:
- the phone connects to the Cloudflare public URL
- Cloudflare connects to the computer in the shop
- your phone does not need to be on the same local network

## 6) Important note about data

This app stores data in the browser on the device being used.

That means:
- data on the phone stays on that phone
- data on the laptop stays on that laptop
- data is not automatically shared between devices

So the correct workflow is:
1. Use the phone in the shop.
2. Export backup JSON file.
3. Save the backup in Google Drive / email / WhatsApp / USB.
4. Later, use the laptop and import the backup file.

## 7) Daily real-use workflow

### On the phone
1. Open the app.
2. Add or update dress catalog items.
3. Record Stock-In entries.
4. Record Stock-Out entries.
5. Check dashboard and reports.
6. Go to Data & Backup.
7. Enter a device name like: `Mobile Shop Phone`.
8. Tap Export Backup.
9. Save the backup file to a safe place.

### On the laptop later
1. Open the app.
2. Go to Data & Backup.
3. Tap Select Backup File.
4. Import the saved JSON file.
5. Continue working from the laptop.

## 8) Best free setup for your shop

Use this setup:
- phone in shop with Cloudflare access
- export backup daily
- laptop later for bigger reporting or full management

This is the easiest free solution without paying for hosting.

## 9) Safety reminder

- Keep at least one backup file on another device or cloud storage.
- Do not rely on one phone alone for long-term stock data.
- Always export backup before switching to another device.

## 10) Summary

Yes — with Cloudflare, your sister can use this app on a phone from a different ISP or location.

The best low-cost workflow is:
- run the app on a computer in the shop
- share it using Cloudflare Tunnel
- use the phone to record stock in real time
- export backup files regularly
- import them later on the laptop

This gives a practical real shop setup without paying for hosting.

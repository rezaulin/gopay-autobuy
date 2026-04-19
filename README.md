# 💰 GoPay Auto-Buy Bot

Bot otomatis buat beli subscription via Stripe checkout pakai GoPay. Cocok buat auto-buy ChatGPT Plus trial.

## Flow
1. Buka link Stripe checkout
2. Pilih GoPay sebagai metode pembayaran
3. Isi billing address (otomatis)
4. Input nomor GoPay
5. Tunggu OTP dari WhatsApp → input OTP
6. Input PIN GoPay
7. Auto-potong Rp1 → selesai

## Install

```bash
git clone https://github.com/rezaulin/gopay-autobuy.git
cd gopay-autobuy
npm install
```

## Cara Pakai

### Interactive mode
```bash
node bot.js
```
Nanti ditanya nomor GoPay dan link checkout satu-satu.

### Direct mode
```bash
# Single checkout
node bot.js --phone 081216599910 --url 'https://checkout.stripe.com/c/pay/cs_live_xxx'

# Multiple checkouts (pisah koma)
node bot.js --phone 081216599910 --urls 'https://checkout.stripe.com/c/pay/cs_live_xxx,https://checkout.stripe.com/c/pay/cs_live_yyy'
```

### With VNC (remote browser view)
```bash
# Terminal 1: Start VNC
./vnc-start.sh

# Terminal 2: Run bot
DISPLAY=:99 node bot.js --phone 081216599910 --url '...'
```
Akses browser via: `http://YOUR_IP:6080/vnc.html`

### All-in-one (VNC + Bot)
```bash
./start.sh --phone 081216599910 --url '...'
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--phone <number>` | Nomor GoPay (e.g. 081216599910) |
| `--url <link>` | Single checkout link |
| `--urls <link1,link2>` | Multiple checkout links (comma-separated) |
| `--headless` | Run without visible browser |

## Requirements

- Node.js 18+
- Chrome/Chromium (auto-downloaded by Puppeteer)
- **IP Indonesia** (GoPay butuh IP lokal Indo)

## ⚠️ Important

**Bot harus jalan dari IP Indonesia!** GoPay tidak bisa diproses dari IP luar negeri.

Options:
1. Jalankan bot di komputer/laptop dengan koneksi Indonesia
2. Pakai VPN/proxy Indonesia
3. Pakai VPS Indonesia sebagai proxy

## Troubleshooting

- **GoPay gak ke-select**: Pastikan Chrome gak di-block. Coba non-headless mode.
- **Form gak valid**: Pastikan semua billing field terisi. Bot auto-fill nama, alamat, kota, kode pos.
- **Gak redirect ke GoPay**: Cek IP lo. GoPay butuh IP Indonesia.
- **OTP gak masuk**: Pastikan nomor GoPay bener. Cek WhatsApp.
- **Timeout**: Cek koneksi internet. Stripe mungkin butuh waktu load.

## Dependencies

- `puppeteer` - Browser automation
- `puppeteer-extra` + `puppeteer-extra-plugin-stealth` - Anti-bot detection bypass

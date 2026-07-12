# MJS Website — Production Deployment Guide
## Cloudflare Workers + R2 Storage Setup

---

## Prerequisites
- Cloudflare account with Workers enabled
- Node.js 18+ installed
- Wrangler CLI installed (`npm install -g wrangler`)
- GitHub repository connected to Cloudflare Workers

---

## File Structure (replace existing files with these)

```
your-repo/
├── public/
│   └── index.html        ← Replace with new index.html
├── worker.js             ← New file (R2 Worker)
├── wrangler.jsonc        ← Replace existing config
├── package.json          ← Replace/create
└── DEPLOYMENT.md         ← This file
```

---

## Step 1 — Login to Cloudflare via Wrangler

```bash
npx wrangler login
```

---

## Step 2 — Create R2 Bucket

```bash
# Create production bucket
npx wrangler r2 bucket create mjs-uploads

# Create preview bucket for local development
npx wrangler r2 bucket create mjs-uploads-preview
```

**Verify creation:**
```bash
npx wrangler r2 bucket list
```
You should see `mjs-uploads` and `mjs-uploads-preview` listed.

---

## Step 3 — Set Admin Token Secret

```bash
npx wrangler secret put ADMIN_TOKEN
```

When prompted, enter: `MJS@2024`

> **Tip:** If you want a stronger password, change it here AND update `UPASS` in `public/index.html` to match.

---

## Step 4 — Install Dependencies

```bash
npm install
```

---

## Step 5 — Test Locally

```bash
npm run dev
```

Visit `http://localhost:8787` — the site should load with full R2 functionality.

**Test upload flow:**
1. Open the site
2. Scroll to footer → click "Admin Login"
3. Login with `superadmin` / `MJS@2024`
4. Go to Annual Reports → upload a PDF
5. Open in incognito window — PDF should appear

---

## Step 6 — Deploy to Production

```bash
npm run deploy
```

Output will show your Worker URL (e.g. `https://mjs-website.your-account.workers.dev`).

---

## Step 7 — Connect Custom Domain

1. Go to Cloudflare Dashboard → Workers & Pages → `mjs-website`
2. Click **Settings** → **Domains & Routes**
3. Click **Add** → **Custom Domain**
4. Enter `mahilajagritisansthan.org`
5. Click **Add Domain**

Cloudflare automatically handles SSL certificates.

---

## Step 8 — GitHub Auto-Deploy (CI/CD)

If your repo is already connected to Cloudflare Workers, push to GitHub:

```bash
git add .
git commit -m "Add R2 storage + update team section"
git push origin main
```

This triggers an automatic deploy via GitHub Actions or Cloudflare's Git integration.

**If not yet connected:**
1. Cloudflare Dashboard → Workers & Pages → `mjs-website`
2. Settings → **Git repository** → Connect to your GitHub repo
3. Set build command: *(leave blank — no build step needed)*
4. Set output directory: *(leave blank)*

---

## API Endpoints Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/list?type=gallery` | None | List all gallery photos |
| GET | `/api/list?type=gallery&category=programs` | None | List photos by category |
| GET | `/api/list?type=reports&reptype=annual` | None | List annual reports |
| GET | `/api/list?type=reports&reptype=financial` | None | List financial reports |
| GET | `/api/file?key=gallery/programs/123_photo.jpg` | None | Download/view file |
| POST | `/api/upload` | Admin | Upload gallery photo or PDF |
| DELETE | `/api/delete?key=...` | Admin | Delete file from R2 |

---

## R2 Bucket Structure

```
mjs-uploads/
├── gallery/
│   ├── programs/    ← Programme & campaign photos
│   ├── trainings/   ← Training photos
│   └── awards/      ← Awards & media photos
└── reports/
    ├── annual/      ← Annual report PDFs
    └── financial/   ← Financial report PDFs
```

---

## Troubleshooting

**"Unauthorized" error on upload:**
- Ensure `ADMIN_TOKEN` secret matches `UPASS` in `index.html`
- Run `wrangler secret put ADMIN_TOKEN` again

**Files not appearing after upload:**
- Check browser console for API errors
- Confirm R2 bucket name in `wrangler.jsonc` matches created bucket

**Worker not serving HTML:**
- Ensure `public/index.html` exists
- Check `assets.directory` in `wrangler.jsonc` points to `./public`

**Local dev R2 not working:**
- Wrangler uses `mjs-uploads-preview` bucket for local dev
- Ensure this bucket exists: `wrangler r2 bucket create mjs-uploads-preview`

---

## Changing the Admin Password

1. Update `UPASS` in `public/index.html`:
   ```javascript
   var UNAME='superadmin', UPASS='YOUR_NEW_PASSWORD';
   ```
2. Update the Worker secret:
   ```bash
   wrangler secret put ADMIN_TOKEN
   # Enter: YOUR_NEW_PASSWORD
   ```
3. Deploy: `npm run deploy`

---

*Generated for Mahila Jagriti Sansthan — mahilajagritisansthan.org*

# Lot Book — Dealership Inventory Dashboard

Track cars, repair costs, customers, sales, and profit.

## Run locally
```
npm install
npm run dev
```

## Deploy to Vercel
1. Push this folder to a GitHub repo.
2. vercel.com -> Add New -> Project -> import the repo.
3. Framework preset: **Vite**. Build command `npm run build`, output dir `dist`.
4. Deploy.

Or from this folder: `npx vercel` then `npx vercel --prod`.

## Important: how data is stored
Data saves to the browser's localStorage — it lives on ONE device/browser.
Logins are not real authentication; passwords are hashed lightly, not securely.

Fine for: your own lot, on your own computer, or demoing to other dealers.
NOT fine for: multiple users, multiple devices, or selling as a product.

To make it real, replace `loadJSON` / `saveJSON` in `src/App.jsx` with calls to a
backend (Supabase is the fastest path — it gives you real auth + a database),
and delete the `scramble()` password function in favor of the backend's auth.

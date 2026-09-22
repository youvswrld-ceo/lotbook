# Lot Book — Dealership Inventory Dashboard

Track cars, repair costs, customers, sales, and profit.

## Run locally
```bash
npm install
cp .env.example .env
# Fill in .env with your Firebase web app configuration, then:
npm run dev
```

## Firebase setup

1. Create a Firebase project and register a Web app in the Firebase console.
2. Enable **Email/Password** under **Authentication → Sign-in method**.
3. Create a Firestore database.
4. Copy `.env.example` to `.env` and enter the Web app configuration values:

```dotenv
VITE_FIREBASE_API_KEY=your_value
VITE_FIREBASE_AUTH_DOMAIN=your_value
VITE_FIREBASE_PROJECT_ID=your_value
VITE_FIREBASE_STORAGE_BUCKET=your_value
VITE_FIREBASE_MESSAGING_SENDER_ID=your_value
VITE_FIREBASE_APP_ID=your_value
```

The local `.env` file is ignored by Git. Add the same variables to your hosting
provider for deployed builds. Deploy `firestore.rules` with the Firebase CLI so
authenticated users can access only their own profile, cars, and customers.

## Deploy to Vercel
1. Push this folder to a GitHub repo.
2. vercel.com -> Add New -> Project -> import the repo.
3. Framework preset: **Vite**. Build command `npm run build`, output dir `dist`.
4. Deploy.

Or from this folder: `npx vercel` then `npx vercel --prod`.

## Data and accounts

Lot Book uses Firebase Authentication for accounts and Cloud Firestore for live,
shared data. Each account's dealership profile is stored at `users/{uid}`, with
inventory and customer records in that user's `cars` and `customers`
subcollections.

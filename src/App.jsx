import { useState, useEffect, useMemo } from "react";

/* ================= helpers ================= */

// Not real cryptography — just avoids storing raw passwords in plain sight.
const scramble = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return "h" + h.toString(36) + "_" + str.length;
};

// Forgiving number parsing — accepts "11,500", "$11500", "64k", etc.
const num = (v) => {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim().toLowerCase().replace(/[$,\s]/g, "");
  const k = s.endsWith("k");
  if (k) s = s.slice(0, -1);
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  if (isNaN(n)) return 0;
  return k ? n * 1000 : n;
};

const money = (n) => {
  if (n === "" || n === null || n === undefined) return "—";
  const v = num(n);
  if (!v && v !== 0) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};

const signedMoney = (v) => (v >= 0 ? "+" : "−") + money(Math.abs(v));

const miles = (v) => {
  if (!v) return "—";
  const n = num(v);
  return n ? n.toLocaleString() + " mi" : String(v);
};

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const d = Math.round((new Date(b) - new Date(a)) / 86400000);
  return isNaN(d) || d < 0 ? null : d;
};

const today = () => new Date().toISOString().slice(0, 10);

const ACCOUNTS_KEY = "dlrs-accounts";
const invKey = (email) => "dlrs-inv-" + email.toLowerCase().replace(/[^a-z0-9]/g, "_");
const custKey = (email) => "dlrs-cust-" + email.toLowerCase().replace(/[^a-z0-9]/g, "_");

const LOCATIONS = ["Front line", "Back lot", "Showroom", "At mechanic", "At detail", "At auction", "Out on test drive", "Off-site"];
const COST_CATEGORIES = ["Mechanical", "Body / paint", "Detail", "Tires", "Transport", "Parts", "Fees / title", "Other"];

const emptyCar = {
  stockNumber: "", year: "", make: "", model: "", trim: "",
  vin: "", mileage: "", color: "", location: "",
  purchasePrice: "", askingPrice: "", soldPrice: "",
  status: "Available", dateAcquired: "", dateSold: "", notes: "",
  costs: [], // {id, desc, category, amount, date}
};

const emptyCustomer = {
  name: "", phone: "", email: "", interestedIn: "",
  status: "New lead", date: "", notes: "",
};

const STATUS_STYLES = {
  Available: { bg: "#E7F0E9", fg: "#1E6B3A", dot: "#2E8B57" },
  Pending:   { bg: "#FBF1DC", fg: "#8A5A00", dot: "#D99000" },
  Sold:      { bg: "#E9ECF6", fg: "#243B8A", dot: "#3554C8" },
};

const CUST_STATUSES = ["New lead", "Contacted", "Test drive", "Negotiating", "Bought", "Lost"];const CUST_STYLES = {
  "New lead":    { bg: "#E9ECF6", fg: "#243B8A" },
  "Contacted":   { bg: "#EDEEF1", fg: "#3A3E46" },
  "Test drive":  { bg: "#FBF1DC", fg: "#8A5A00" },
  "Negotiating": { bg: "#FBE9D9", fg: "#8A4400" },
  "Bought":      { bg: "#E7F0E9", fg: "#1E6B3A" },
  "Lost":        { bg: "#FBEAEA", fg: "#9B1C1C" },
};

// what the car has cost you so far: purchase + all repairs/recon
const reconTotal = (c) => (c.costs || []).reduce((s, x) => s + num(x.amount), 0);
const totalIn = (c) => num(c.purchasePrice) + reconTotal(c);
const carName = (c) => [c.year, c.make, c.model].filter(Boolean).join(" ") || "Untitled vehicle";

/* ================= storage ================= */

// Browser localStorage. Data lives on this device/browser only.
// To share one lot across computers, swap these two functions for API calls
// to a real backend (Supabase, Firebase, your own server).
async function loadJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
async function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ================= root ================= */

export default function App() {
  const [session, setSession] = useState(null); // {email, dealership}
  return (
    <div style={{ minHeight: "100vh", background: "#F1F2F4", fontFamily: "'Barlow', system-ui, sans-serif", color: "#16181D" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        * { box-sizing: border-box; }
        input, select, textarea { font-family: inherit; }
        .plate {
          font-family: 'IBM Plex Mono', monospace; font-weight: 600; letter-spacing: 0.06em;
          background: #16181D; color: #F5D547; border-radius: 4px; padding: 2px 8px;
          display: inline-block; font-size: 12px; border: 1px solid #000;
          box-shadow: inset 0 0 0 1.5px rgba(245,213,71,.35);
        }
        .field-label {
          font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 12px;
          letter-spacing: 0.09em; text-transform: uppercase; color: #5B616B;
          display: block; margin-bottom: 4px;
        }
        .txt {
          width: 100%; padding: 9px 11px; border: 1px solid #C9CDD3; border-radius: 6px;
          font-size: 14px; background: #fff; outline: none;
        }
        .txt:focus { border-color: #1F4FD8; box-shadow: 0 0 0 3px rgba(31,79,216,.15); }
        .btn-primary {
          background: #1F4FD8; color: #fff; border: none; border-radius: 6px;
          padding: 10px 18px; font-weight: 600; font-size: 14px; cursor: pointer;
        }
        .btn-primary:hover { background: #1A43B8; }
        .btn-quiet {
          background: #fff; color: #16181D; border: 1px solid #C9CDD3; border-radius: 6px;
          padding: 9px 16px; font-weight: 500; font-size: 14px; cursor: pointer;
        }
        .btn-quiet:hover { background: #F1F2F4; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #1F4FD8; outline-offset: 1px; }
        table { border-collapse: collapse; width: 100%; }
        th {
          font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 12px;
          letter-spacing: .09em; text-transform: uppercase; color: #5B616B;
          text-align: left; padding: 10px 12px; border-bottom: 2px solid #E2E4E8; white-space: nowrap;
        }
        td { padding: 12px; border-bottom: 1px solid #ECEDF0; font-size: 14px; vertical-align: middle; }
        tr:hover td { background: #F8F9FB; }
        .pill { border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; display: inline-block; }
        .card { background: #fff; border: 1px solid #E2E4E8; border-radius: 10px; }
        .err-box { background: #FBEAEA; color: #9B1C1C; border-radius: 6px; padding: 9px 12px; font-size: 13px; margin-bottom: 14px; }
      `}</style>
      {session
        ? <Dashboard session={session} onLogout={() => setSession(null)} />
        : <AuthScreen onLogin={setSession} />}
    </div>
  );
}

/* ================= auth ================= */

function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [dealership, setDealership] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    const em = email.trim().toLowerCase();
    if (!em || !em.includes("@")) return setErr("Enter a valid email address.");
    if (pw.length < 4) return setErr("Password needs at least 4 characters.");
    setBusy(true);
    const accounts = await loadJSON(ACCOUNTS_KEY, {});
    if (mode === "signup") {
      if (!dealership.trim()) { setBusy(false); return setErr("Enter your dealership name."); }
      if (accounts[em]) { setBusy(false); return setErr("An account with that email already exists. Log in instead."); }
      accounts[em] = { pw: scramble(pw), dealership: dealership.trim() };
      const ok = await saveJSON(ACCOUNTS_KEY, accounts);
      if (!ok) { setBusy(false); return setErr("Couldn't save the account. Try again."); }
      onLogin({ email: em, dealership: dealership.trim() });
    } else {
      const acct = accounts[em];
      if (!acct || acct.pw !== scramble(pw)) { setBusy(false); return setErr("Email or password doesn't match."); }
      onLogin({ email: em, dealership: acct.dealership });
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div className="plate" style={{ fontSize: 14, padding: "5px 14px" }}>LOT BOOK</div>
          <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 34, margin: "12px 0 4px", letterSpacing: ".02em" }}>
            Dealership inventory, off the notepad
          </h1>
          <p style={{ color: "#5B616B", fontSize: 14, margin: 0 }}>
            Cars, repair costs, customers, and profit — one place. Each login keeps its own lot.
          </p>
        </div>

        <div className="card" style={{ padding: 24, boxShadow: "0 1px 3px rgba(22,24,29,.06)" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "#F1F2F4", borderRadius: 8, padding: 4 }}>
            {["login", "signup"].map((m) => (
              <button key={m} onClick={() => { setMode(m); setErr(""); }}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer",
                  fontWeight: 600, fontSize: 14,
                  background: mode === m ? "#fff" : "transparent",
                  color: mode === m ? "#16181D" : "#5B616B",
                  boxShadow: mode === m ? "0 1px 2px rgba(22,24,29,.12)" : "none",
                }}>
                {m === "login" ? "Log in" : "Create account"}
              </button>
            ))}
          </div>

          {mode === "signup" && (
            <div style={{ marginBottom: 14 }}>
              <label className="field-label">Dealership name</label>
              <input className="txt" value={dealership} onChange={(e) => setDealership(e.target.value)} placeholder="Riverside Auto Sales" />
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <label className="field-label">Email</label>
            <input className="txt" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dealership.com" type="email" />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label className="field-label">Password</label>
            <input className="txt" value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="••••••••"
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>

          {err && <div className="err-box">{err}</div>}

          <button className="btn-primary" style={{ width: "100%" }} onClick={submit} disabled={busy}>
            {busy ? "Working…" : mode === "login" ? "Log in" : "Create account & open my lot"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= dashboard shell ================= */

const TABS = [["lot", "The lot"], ["sales", "Sales"], ["customers", "Customers"], ["reports", "Reports"]];

function Dashboard({ session, onLogout }) {
  const [cars, setCars] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [page, setPage] = useState("lot");
  const [editing, setEditing] = useState(null);        // car or "new"
  const [selling, setSelling] = useState(null);        // car
  const [confirmDelete, setConfirmDelete] = useState(null); // car
  const [editingCust, setEditingCust] = useState(null); // customer or "new"
  const [confirmDeleteCust, setConfirmDeleteCust] = useState(null);
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    loadJSON(invKey(session.email), []).then((list) =>
      setCars(list.map((c) => ({ ...emptyCar, ...c, costs: c.costs || [] })))
    );
    loadJSON(custKey(session.email), []).then(setCustomers);
  }, [session.email]);

  const persistCars = async (next) => {
    setCars(next);
    const ok = await saveJSON(invKey(session.email), next);
    setSaveErr(ok ? "" : "Couldn't save changes to storage — your last edit may not persist.");
  };
  const persistCustomers = async (next) => {
    setCustomers(next);
    const ok = await saveJSON(custKey(session.email), next);
    setSaveErr(ok ? "" : "Couldn't save changes to storage — your last edit may not persist.");
  };

  const upsertCar = (car) => {
    const next = car.id
      ? cars.map((c) => (c.id === car.id ? car : c))
      : [...cars, { ...car, id: "c" + Date.now() + Math.random().toString(36).slice(2, 6) }];
    persistCars(next);
    setEditing(null);
  };
  const removeCar = (id) => { persistCars(cars.filter((c) => c.id !== id)); setConfirmDelete(null); };

  const markSold = (id, soldPrice, dateSold) => {
    persistCars(cars.map((c) => (c.id === id ? { ...c, status: "Sold", soldPrice, dateSold } : c)));
    setSelling(null);
  };

  const upsertCustomer = (cust) => {
    const next = cust.id
      ? customers.map((c) => (c.id === cust.id ? cust : c))
      : [...customers, { ...cust, id: "u" + Date.now() + Math.random().toString(36).slice(2, 6), date: cust.date || today() }];
    persistCustomers(next);
    setEditingCust(null);
  };
  const removeCustomer = (id) => { persistCustomers(customers.filter((c) => c.id !== id)); setConfirmDeleteCust(null); };

  const soldCars = useMemo(() => {
    if (!cars) return [];
    return cars.filter((c) => c.status === "Sold").sort((a, b) => (b.dateSold || "").localeCompare(a.dateSold || ""));
  }, [cars]);

  const loading = cars === null || customers === null;

  return (
    <div>
      <header style={{ background: "#16181D", color: "#fff", padding: "0 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 62, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="plate">LOT BOOK</span>
            <div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 19, letterSpacing: ".03em", lineHeight: 1.1 }}>{session.dealership}</div>
              <div style={{ fontSize: 11, color: "#9BA1AB" }}>{session.email}</div>
            </div>
          </div>
          <button className="btn-quiet" style={{ background: "transparent", color: "#C9CDD3", borderColor: "#3A3E46" }} onClick={onLogout}>Log out</button>
        </div>
      </header>

      <nav style={{ background: "#16181D", padding: "0 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", gap: 4, overflowX: "auto" }}>
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setPage(id)}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 15,
                letterSpacing: ".06em", textTransform: "uppercase",
                color: page === id ? "#fff" : "#9BA1AB",
                padding: "10px 16px 12px", whiteSpace: "nowrap",
                borderBottom: page === id ? "3px solid #F5D547" : "3px solid transparent",
              }}>
              {label}
              {id === "sales" && soldCars.length > 0 ? ` (${soldCars.length})` : ""}
              {id === "customers" && customers && customers.length > 0 ? ` (${customers.length})` : ""}
            </button>
          ))}
        </div>
      </nav>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 60px" }}>
        {loading ? (
          <p style={{ color: "#5B616B" }}>Loading your lot…</p>
        ) : (
          <>
            {saveErr && <div className="err-box">{saveErr}</div>}
            {page === "lot" && (
              <LotPage cars={cars} soldCount={soldCars.length} session={session}
                onAdd={() => setEditing("new")} onEdit={setEditing} onSell={setSelling} onDelete={setConfirmDelete} />
            )}
            {page === "sales" && <SalesPage soldCars={soldCars} onEdit={setEditing} />}
            {page === "customers" && (
              <CustomersPage customers={customers} cars={cars}
                onAdd={() => setEditingCust("new")} onEdit={setEditingCust} onDelete={setConfirmDeleteCust} />
            )}
            {page === "reports" && <ReportsPage cars={cars} soldCars={soldCars} />}
          </>
        )}
      </main>

      {editing && <CarModal initial={editing === "new" ? emptyCar : editing} onCancel={() => setEditing(null)} onSave={upsertCar} />}
      {selling && <SellModal car={selling} onCancel={() => setSelling(null)} onSell={markSold} />}
      {editingCust && <CustomerModal initial={editingCust === "new" ? emptyCustomer : editingCust} cars={cars} onCancel={() => setEditingCust(null)} onSave={upsertCustomer} />}

      {confirmDelete && (
        <Modal title="Remove this car?" onClose={() => setConfirmDelete(null)}>
          <p style={{ fontSize: 14, color: "#5B616B", marginTop: 0 }}>
            <strong>{carName(confirmDelete)}</strong>
            {confirmDelete.stockNumber ? ` (stock ${confirmDelete.stockNumber})` : ""} will be permanently removed, along with its repair history. This can't be undone.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn-quiet" onClick={() => setConfirmDelete(null)}>Keep it</button>
            <button className="btn-primary" style={{ background: "#9B1C1C" }} onClick={() => removeCar(confirmDelete.id)}>Remove car</button>
          </div>
        </Modal>
      )}
      {confirmDeleteCust && (
        <Modal title="Remove this customer?" onClose={() => setConfirmDeleteCust(null)}>
          <p style={{ fontSize: 14, color: "#5B616B", marginTop: 0 }}>
            <strong>{confirmDeleteCust.name || "This customer"}</strong> will be permanently removed. This can't be undone.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn-quiet" onClick={() => setConfirmDeleteCust(null)}>Keep them</button>
            <button className="btn-primary" style={{ background: "#9B1C1C" }} onClick={() => removeCustomer(confirmDeleteCust.id)}>Remove customer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= lot page ================= */

function LotPage({ cars, soldCount, session, onAdd, onEdit, onSell, onDelete }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [locFilter, setLocFilter] = useState("All");
  const [sortBy, setSortBy] = useState("newest");
  const usedLocations = useMemo(() => {
    const set = new Set(LOCATIONS);
    cars.forEach((c) => c.location && set.add(c.location));
    return [...set];
  }, [cars]);

  const filtered = useMemo(() => {
    let list = cars.filter((c) => {
      if (statusFilter !== "All" && c.status !== statusFilter) return false;
      if (locFilter !== "All" && (c.location || "") !== locFilter) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [c.stockNumber, c.year, c.make, c.model, c.trim, c.vin, c.color, c.location, c.notes]
        .join(" ").toLowerCase().includes(q);
    });
    const sorters = {
      newest: (a, b) => (b.dateAcquired || "").localeCompare(a.dateAcquired || ""),
      oldest: (a, b) => (a.dateAcquired || "").localeCompare(b.dateAcquired || ""),
      priceHigh: (a, b) => num(b.askingPrice) - num(a.askingPrice),
      priceLow: (a, b) => num(a.askingPrice) - num(b.askingPrice),
      stock: (a, b) => (a.stockNumber || "").localeCompare(b.stockNumber || "", undefined, { numeric: true }),
    };
    return [...list].sort(sorters[sortBy] || sorters.newest);
  }, [cars, search, statusFilter, locFilter, sortBy]);

  const stats = useMemo(() => {
    const inStock = cars.filter((c) => c.status !== "Sold");
    const invested = inStock.reduce((s, c) => s + totalIn(c), 0);
    const recon = inStock.reduce((s, c) => s + reconTotal(c), 0);
    const potential = inStock.reduce((s, c) => s + num(c.askingPrice), 0);
    const realized = cars.filter((c) => c.status === "Sold").reduce((s, c) => s + (num(c.soldPrice) - totalIn(c)), 0);
    return { inStockCount: inStock.length, invested, recon, potential, realized };
  }, [cars]);

  const exportCSV = () => {
    const cols = ["stockNumber","year","make","model","trim","vin","mileage","color","location","status","purchasePrice","reconTotal","totalIn","askingPrice","soldPrice","dateAcquired","dateSold","repairDetails","notes"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [cols.join(","), ...cars.map((c) => cols.map((k) => {
      if (k === "reconTotal") return esc(reconTotal(c));
      if (k === "totalIn") return esc(totalIn(c));
      if (k === "repairDetails") return esc((c.costs || []).map((x) => `${x.desc || x.category || "cost"}: $${num(x.amount)}`).join(" | "));
      return esc(c[k]);
    }).join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = session.dealership.replace(/\s+/g, "-").toLowerCase() + "-inventory.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="Cars on the lot" value={stats.inStockCount} sub={soldCount + " sold all-time"} />
        <StatCard label="Total in inventory" value={money(stats.invested)} sub={"purchases + " + money(stats.recon) + " in repairs"} />
        <StatCard label="Lot asking total" value={money(stats.potential)} sub="if everything sells at ask" />
        <StatCard label="Realized profit" value={money(stats.realized)} sub="after purchase & repair costs" accent={stats.realized >= 0 ? "#1E6B3A" : "#9B1C1C"} />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input className="txt" style={{ maxWidth: 280 }} placeholder="Search stock #, make, VIN…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="txt" style={{ width: "auto" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {["All", "Available", "Pending", "Sold"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="txt" style={{ width: "auto" }} value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
          <option value="All">All locations</option>
          {usedLocations.map((l) => <option key={l}>{l}</option>)}
        </select>
        <select className="txt" style={{ width: "auto" }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="newest">Newest arrivals first</option>
          <option value="oldest">Oldest arrivals first</option>
          <option value="priceHigh">Asking price: high to low</option>
          <option value="priceLow">Asking price: low to high</option>
          <option value="stock">Stock # order</option>
        </select>
        <div style={{ flex: 1 }} />
        {cars.length > 0 && <button className="btn-quiet" onClick={exportCSV}>Export CSV</button>}
        <button className="btn-primary" onClick={onAdd}>+ Add a car</button>
      </div>

      {cars.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #C9CDD3", borderRadius: 10, padding: "60px 24px", textAlign: "center" }}>
          <div className="plate" style={{ fontSize: 13 }}>STK-0001</div>
          <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 24, margin: "14px 0 6px" }}>Your lot is empty</h2>
          <p style={{ color: "#5B616B", fontSize: 14, margin: "0 0 18px" }}>Add your first car to replace the notepad — stock number, what you paid, repairs, and everything else.</p>
          <button className="btn-primary" onClick={onAdd}>+ Add your first car</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: "40px 24px", textAlign: "center", color: "#5B616B", fontSize: 14 }}>
          No cars match that search or filter. Clear the search to see the full lot.
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Stock #</th><th>Vehicle</th><th>Location</th><th>Mileage</th><th>Total in it</th><th>Asking</th><th>Margin</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const cost = totalIn(c);
                const recon = reconTotal(c);
                const target = c.status === "Sold" ? num(c.soldPrice) : num(c.askingPrice);
                const margin = target - cost;
                const st = STATUS_STYLES[c.status] || STATUS_STYLES.Available;
                const onLot = c.status !== "Sold" && c.dateAcquired ? daysBetween(c.dateAcquired, today()) : null;
                return (
                  <tr key={c.id}>
                    <td><span className="plate">{c.stockNumber || "—"}</span></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{carName(c)}</div>
                      <div style={{ fontSize: 12, color: "#5B616B" }}>
                        {[c.trim, c.color, c.vin && "VIN " + c.vin, onLot !== null && onLot + " days on lot"].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td>
                      {c.location
                        ? <span className="pill" style={{ background: "#F1F2F4", border: "1px solid #E2E4E8", fontWeight: 500 }}>📍 {c.location}</span>
                        : <button className="btn-quiet" style={{ padding: "3px 10px", fontSize: 12, color: "#5B616B" }} onClick={() => onEdit(c)}>Set location</button>}
                    </td>
                    <td>{miles(c.mileage)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{money(cost)}</div>
                      {recon > 0 && <div style={{ fontSize: 11, color: "#8A5A00" }}>🔧 {money(recon)} repairs</div>}
                    </td>
                    <td>{c.status === "Sold" ? <span>{money(c.soldPrice)} <span style={{ fontSize: 11, color: "#5B616B" }}>sold</span></span> : money(c.askingPrice)}</td>
                    <td style={{ fontWeight: 600, color: margin >= 0 ? "#1E6B3A" : "#9B1C1C" }}>
                      {cost || target ? signedMoney(margin) : "—"}
                    </td>
                    <td>
                      <span className="pill" style={{ background: st.bg, color: st.fg }}>
                        <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: st.dot, marginRight: 6 }} />
                        {c.status}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {c.status !== "Sold" && (
                        <button className="btn-quiet" style={{ padding: "5px 12px", marginRight: 6, color: "#1E6B3A", borderColor: "#A9C9B4", fontWeight: 600 }} onClick={() => onSell(c)}>Sell</button>
                      )}
                      <button className="btn-quiet" style={{ padding: "5px 12px", marginRight: 6 }} onClick={() => onEdit(c)}>Edit</button>
                      <button className="btn-quiet" style={{ padding: "5px 12px", color: "#9B1C1C" }} onClick={() => onDelete(c)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ================= sales page ================= */

function SalesPage({ soldCars, onEdit }) {
  const totalRevenue = soldCars.reduce((s, c) => s + num(c.soldPrice), 0);
  const totalCost = soldCars.reduce((s, c) => s + totalIn(c), 0);
  const totalProfit = totalRevenue - totalCost;

  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const soldThisMonth = soldCars.filter((c) => (c.dateSold || "").startsWith(thisMonthKey));
  const monthProfit = soldThisMonth.reduce((s, c) => s + (num(c.soldPrice) - totalIn(c)), 0);

  const withDays = soldCars.map((c) => daysBetween(c.dateAcquired, c.dateSold)).filter((d) => d !== null);
  const avgDays = withDays.length ? Math.round(withDays.reduce((a, b) => a + b, 0) / withDays.length) : null;

  if (soldCars.length === 0) {
    return (
      <div style={{ background: "#fff", border: "1px dashed #C9CDD3", borderRadius: 10, padding: "60px 24px", textAlign: "center" }}>
        <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 24, margin: "0 0 6px" }}>No sales yet</h2>
        <p style={{ color: "#5B616B", fontSize: 14, margin: 0 }}>
          When a car sells, hit the green <strong>Sell</strong> button next to it on the lot page — it'll move here with its true profit after repairs.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="Cars sold" value={soldCars.length} sub={soldThisMonth.length + " this month"} />
        <StatCard label="Total sales revenue" value={money(totalRevenue)} sub="all sold cars combined" />
        <StatCard label="Total profit" value={money(totalProfit)} sub="after purchase & repair costs" accent={totalProfit >= 0 ? "#1E6B3A" : "#9B1C1C"} />
        <StatCard label="Profit this month" value={money(monthProfit)} sub={avgDays !== null ? "avg " + avgDays + " days on lot to sell" : "add acquired & sold dates to see days-to-sell"} accent={monthProfit >= 0 ? "#1E6B3A" : "#9B1C1C"} />
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>Stock #</th><th>Vehicle</th><th>Date sold</th><th>Days on lot</th><th>Total in it</th><th>Sold for</th><th>Profit</th><th></th></tr>
          </thead>
          <tbody>
            {soldCars.map((c) => {
              const cost = totalIn(c);
              const recon = reconTotal(c);
              const profit = num(c.soldPrice) - cost;
              const d = daysBetween(c.dateAcquired, c.dateSold);
              return (
                <tr key={c.id}>
                  <td><span className="plate">{c.stockNumber || "—"}</span></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{carName(c)}</div>
                    <div style={{ fontSize: 12, color: "#5B616B" }}>{[c.trim, c.color, c.vin && "VIN " + c.vin].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td>{c.dateSold || "—"}</td>
                  <td>{d !== null ? d + " days" : "—"}</td>
                  <td>
                    <div>{money(cost)}</div>
                    {recon > 0 && <div style={{ fontSize: 11, color: "#8A5A00" }}>🔧 {money(recon)} repairs</div>}
                  </td>
                  <td style={{ fontWeight: 600 }}>{money(c.soldPrice)}</td>
                  <td style={{ fontWeight: 600, color: profit >= 0 ? "#1E6B3A" : "#9B1C1C" }}>{signedMoney(profit)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn-quiet" style={{ padding: "5px 12px" }} onClick={() => onEdit(c)}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ================= customers page ================= */

function CustomersPage({ customers, cars, onAdd, onEdit, onDelete }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (statusFilter !== "All" && c.status !== statusFilter) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [c.name, c.phone, c.email, c.interestedIn, c.notes].join(" ").toLowerCase().includes(q);
    }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [customers, search, statusFilter]);

  const active = customers.filter((c) => !["Bought", "Lost"].includes(c.status)).length;
  const bought = customers.filter((c) => c.status === "Bought").length;
  const hot = customers.filter((c) => ["Test drive", "Negotiating"].includes(c.status)).length;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="All customers" value={customers.length} sub={active + " still active"} />
        <StatCard label="Hot right now" value={hot} sub="test drives & negotiating" accent={hot > 0 ? "#8A4400" : undefined} />
        <StatCard label="Bought a car" value={bought} sub="closed customers" accent="#1E6B3A" />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input className="txt" style={{ maxWidth: 280 }} placeholder="Search name, phone, car…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="txt" style={{ width: "auto" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option>All</option>
          {CUST_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn-primary" onClick={onAdd}>+ Add a customer</button>
      </div>

      {customers.length === 0 ? (
        <div style={{ background: "#fff", border: "1px dashed #C9CDD3", borderRadius: 10, padding: "60px 24px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 24, margin: "0 0 6px" }}>No customers yet</h2>
          <p style={{ color: "#5B616B", fontSize: 14, margin: "0 0 18px" }}>
            When someone calls about a car or walks the lot, jot them down here — name, number, and which car they're eyeing. Never lose a lead to a sticky note again.
          </p>
          <button className="btn-primary" onClick={onAdd}>+ Add your first customer</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: "40px 24px", textAlign: "center", color: "#5B616B", fontSize: 14 }}>
          No customers match that search or filter.
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Customer</th><th>Contact</th><th>Interested in</th><th>Status</th><th>Added</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const st = CUST_STYLES[c.status] || CUST_STYLES["New lead"];
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name || "—"}</td>
                    <td>
                      <div>{c.phone || "—"}</div>
                      {c.email && <div style={{ fontSize: 12, color: "#5B616B" }}>{c.email}</div>}
                    </td>
                    <td>{c.interestedIn || "—"}</td>
                    <td><span className="pill" style={{ background: st.bg, color: st.fg }}>{c.status}</span></td>
                    <td style={{ whiteSpace: "nowrap" }}>{c.date || "—"}</td>
                    <td style={{ maxWidth: 220, fontSize: 13, color: "#5B616B" }}>{c.notes || ""}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <button className="btn-quiet" style={{ padding: "5px 12px", marginRight: 6 }} onClick={() => onEdit(c)}>Edit</button>
                      <button className="btn-quiet" style={{ padding: "5px 12px", color: "#9B1C1C" }} onClick={() => onDelete(c)}>Remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ================= reports page ================= */

function ReportsPage({ cars, soldCars }) {
  const inStock = cars.filter((c) => c.status !== "Sold");

  // aging
  const aging = inStock
    .map((c) => ({ car: c, days: c.dateAcquired ? daysBetween(c.dateAcquired, today()) : null }))
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  const stale = aging.filter((a) => a.days !== null && a.days > 60).length;

  // monthly breakdown
  const months = {};
  soldCars.forEach((c) => {
    const key = (c.dateSold || "").slice(0, 7);
    if (!key) return;
    if (!months[key]) months[key] = { count: 0, revenue: 0, cost: 0 };
    months[key].count++;
    months[key].revenue += num(c.soldPrice);
    months[key].cost += totalIn(c);
  });
  const monthRows = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0]));
  const monthLabel = (key) => {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  };

  // best & worst flips
  const flips = soldCars.map((c) => ({ car: c, profit: num(c.soldPrice) - totalIn(c) })).sort((a, b) => b.profit - a.profit);
  const best = flips[0];
  const worst = flips.length > 1 ? flips[flips.length - 1] : null;

  const totalRecon = cars.reduce((s, c) => s + reconTotal(c), 0);

  const agingColor = (d) => (d === null ? "#5B616B" : d > 60 ? "#9B1C1C" : d > 30 ? "#8A5A00" : "#1E6B3A");

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="Sitting 60+ days" value={stale} sub="cars that may need a price cut" accent={stale > 0 ? "#9B1C1C" : "#1E6B3A"} />
        <StatCard label="Repair spend all-time" value={money(totalRecon)} sub="across every car, sold & in stock" />
        {best && <StatCard label="Best flip" value={signedMoney(best.profit)} sub={carName(best.car)} accent="#1E6B3A" />}
        {worst && worst.profit < (best?.profit ?? 0) && <StatCard label="Toughest flip" value={signedMoney(worst.profit)} sub={carName(worst.car)} accent={worst.profit < 0 ? "#9B1C1C" : undefined} />}
      </div>

      <SectionTitle>Inventory aging — what's been sitting</SectionTitle>
      {inStock.length === 0 ? (
        <div className="card" style={{ padding: "30px 24px", textAlign: "center", color: "#5B616B", fontSize: 14, marginBottom: 28 }}>
          Nothing in stock right now.
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto", marginBottom: 28 }}>
          <table>
            <thead><tr><th>Stock #</th><th>Vehicle</th><th>Days on lot</th><th>Total in it</th><th>Asking</th><th>Location</th></tr></thead>
            <tbody>
              {aging.map(({ car: c, days }) => (
                <tr key={c.id}>
                  <td><span className="plate">{c.stockNumber || "—"}</span></td>
                  <td style={{ fontWeight: 600 }}>{carName(c)}</td>
                  <td style={{ fontWeight: 700, color: agingColor(days) }}>
                    {days !== null ? days + " days" : "no date set"}
                    {days !== null && days > 60 && <span style={{ fontWeight: 500, fontSize: 12 }}> — consider a price cut</span>}
                  </td>
                  <td>{money(totalIn(c))}</td>
                  <td>{money(c.askingPrice)}</td>
                  <td style={{ fontSize: 13, color: "#5B616B" }}>{c.location || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle>Month by month</SectionTitle>
      {monthRows.length === 0 ? (
        <div className="card" style={{ padding: "30px 24px", textAlign: "center", color: "#5B616B", fontSize: 14 }}>
          No sales recorded yet — sell a car (with a sold date) and the monthly breakdown builds itself.
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Month</th><th>Cars sold</th><th>Revenue</th><th>Cost (purchase + repairs)</th><th>Profit</th></tr></thead>
            <tbody>
              {monthRows.map(([key, m]) => {
                const profit = m.revenue - m.cost;
                return (
                  <tr key={key}>
                    <td style={{ fontWeight: 600 }}>{monthLabel(key)}</td>
                    <td>{m.count}</td>
                    <td>{money(m.revenue)}</td>
                    <td>{money(m.cost)}</td>
                    <td style={{ fontWeight: 700, color: profit >= 0 ? "#1E6B3A" : "#9B1C1C" }}>{signedMoney(profit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: ".03em", margin: "0 0 12px" }}>
      {children}
    </h2>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div className="field-label" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 30, lineHeight: 1, color: accent || "#16181D" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#5B616B", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

/* ================= modals ================= */

function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,24,29,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto", zIndex: 50 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: wide ? 720 : 440, padding: 24, boxShadow: "0 10px 40px rgba(22,24,29,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 24, margin: 0 }}>{title}</h2>
          <button className="btn-quiet" style={{ padding: "4px 10px" }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 12 }}>{children}</div>
  );
}

/* ---------- car modal with repair costs ---------- */

function CarModal({ initial, onCancel, onSave }) {
  const [car, setCar] = useState({ ...initial, costs: initial.costs || [] });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setCar((prev) => ({ ...prev, [k]: e.target.value }));

  const setCost = (id, k, v) =>
    setCar((prev) => ({ ...prev, costs: prev.costs.map((x) => (x.id === id ? { ...x, [k]: v } : x)) }));
  const addCost = () =>
    setCar((prev) => ({ ...prev, costs: [...prev.costs, { id: "x" + Date.now() + Math.random().toString(36).slice(2, 5), desc: "", category: "Mechanical", amount: "", date: "" }] }));
  const removeCost = (id) =>
    setCar((prev) => ({ ...prev, costs: prev.costs.filter((x) => x.id !== id) }));

  const recon = reconTotal(car);
  const total = totalIn(car);

  const save = () => {
    if (!car.stockNumber.trim()) return setErr("A stock number is required — it's how you'll find the car.");
    if (!car.make.trim() && !car.model.trim()) return setErr("Enter at least a make or model.");
    onSave({ ...car, stockNumber: car.stockNumber.trim(), costs: car.costs.filter((x) => x.desc || num(x.amount)) });
  };

  return (
    <Modal title={initial.id ? "Edit car" : "Add a car to the lot"} onClose={onCancel} wide>
      <Row>
        <div><label className="field-label">Stock # *</label><input className="txt" value={car.stockNumber} onChange={set("stockNumber")} placeholder="STK-1042" /></div>
        <div><label className="field-label">Status</label>
          <select className="txt" value={car.status} onChange={set("status")}>
            {["Available", "Pending", "Sold"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div><label className="field-label">Date acquired</label><input className="txt" type="date" value={car.dateAcquired} onChange={set("dateAcquired")} /></div>
      </Row>
      <Row>
        <div><label className="field-label">Year</label><input className="txt" value={car.year} onChange={set("year")} placeholder="2019" inputMode="numeric" /></div>
        <div><label className="field-label">Make</label><input className="txt" value={car.make} onChange={set("make")} placeholder="Toyota" /></div>
        <div><label className="field-label">Model</label><input className="txt" value={car.model} onChange={set("model")} placeholder="Camry" /></div>
        <div><label className="field-label">Trim</label><input className="txt" value={car.trim} onChange={set("trim")} placeholder="SE" /></div>
      </Row>
      <Row>
        <div><label className="field-label">VIN</label><input className="txt" value={car.vin} onChange={set("vin")} placeholder="17 characters" /></div>
        <div><label className="field-label">Mileage</label><input className="txt" value={car.mileage} onChange={set("mileage")} placeholder="64200" inputMode="numeric" /></div>
        <div><label className="field-label">Color</label><input className="txt" value={car.color} onChange={set("color")} placeholder="Silver" /></div>
      </Row>
      <Row>
        <div>
          <label className="field-label">Where is this car?</label>
          <input className="txt" value={car.location || ""} onChange={set("location")} list="lot-locations" placeholder="Front line, back lot, at mechanic…" />
          <datalist id="lot-locations">
            {LOCATIONS.map((l) => <option key={l} value={l} />)}
          </datalist>
        </div>
      </Row>
      <Row>
        <div><label className="field-label">What you paid ($)</label><input className="txt" value={car.purchasePrice} onChange={set("purchasePrice")} placeholder="11500" inputMode="numeric" /></div>
        <div><label className="field-label">Asking price ($)</label><input className="txt" value={car.askingPrice} onChange={set("askingPrice")} placeholder="14990" inputMode="numeric" /></div>
        {car.status === "Sold" && (
          <>
            <div><label className="field-label">Sold price ($)</label><input className="txt" value={car.soldPrice} onChange={set("soldPrice")} placeholder="14200" inputMode="numeric" /></div>
            <div><label className="field-label">Date sold</label><input className="txt" type="date" value={car.dateSold} onChange={set("dateSold")} /></div>
          </>
        )}
      </Row>

      {/* repair & recon costs */}
      <div style={{ background: "#F8F9FB", border: "1px solid #E2E4E8", borderRadius: 8, padding: "14px 14px 6px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <span className="field-label" style={{ margin: 0 }}>🔧 Repairs, damage & other costs</span>
          <span style={{ fontSize: 13, color: "#5B616B" }}>
            {recon > 0 ? <>Repairs: <strong>{money(recon)}</strong> · Total in it: <strong>{money(total)}</strong></> : "Nothing added yet"}
          </span>
        </div>
        {car.costs.map((x) => (
          <div key={x.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 100px 130px 34px", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <input className="txt" value={x.desc} onChange={(e) => setCost(x.id, "desc", e.target.value)} placeholder="Front brakes + rotors" />
            <select className="txt" value={x.category} onChange={(e) => setCost(x.id, "category", e.target.value)}>
              {COST_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input className="txt" value={x.amount} onChange={(e) => setCost(x.id, "amount", e.target.value)} placeholder="$" inputMode="numeric" />
            <input className="txt" type="date" value={x.date} onChange={(e) => setCost(x.id, "date", e.target.value)} />
            <button className="btn-quiet" style={{ padding: "6px 8px", color: "#9B1C1C" }} onClick={() => removeCost(x.id)} aria-label="Remove cost">✕</button>
          </div>
        ))}
        <button className="btn-quiet" style={{ marginBottom: 8, fontSize: 13, padding: "6px 12px" }} onClick={addCost}>+ Add a cost</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Notes</label>
        <textarea className="txt" rows={3} value={car.notes} onChange={set("notes")} placeholder="One owner, small ding on rear passenger door…" />
      </div>

      {err && <div className="err-box">{err}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={save}>{initial.id ? "Save changes" : "Add to lot"}</button>
      </div>
    </Modal>
  );
}

/* ---------- sell modal ---------- */

function SellModal({ car, onCancel, onSell }) {
  const [price, setPrice] = useState(car.askingPrice || "");
  const [date, setDate] = useState(today());
  const [err, setErr] = useState("");

  const cost = totalIn(car);
  const recon = reconTotal(car);
  const profit = num(price) - cost;

  const confirm = () => {
    if (!num(price)) return setErr("Enter the price the car sold for.");
    onSell(car.id, price, date);
  };

  return (
    <Modal title="Mark as sold" onClose={onCancel}>
      <p style={{ fontSize: 14, color: "#5B616B", marginTop: 0 }}>
        <span className="plate" style={{ marginRight: 8 }}>{car.stockNumber || "—"}</span>
        <strong>{carName(car)}</strong>
      </p>
      <div style={{ marginBottom: 12 }}>
        <label className="field-label">Sold price ($)</label>
        <input className="txt" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" autoFocus
          onKeyDown={(e) => e.key === "Enter" && confirm()} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="field-label">Date sold</label>
        <input className="txt" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {num(price) > 0 && (
        <div style={{ background: profit >= 0 ? "#E7F0E9" : "#FBEAEA", color: profit >= 0 ? "#1E6B3A" : "#9B1C1C", borderRadius: 6, padding: "9px 12px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
          {profit >= 0 ? "Profit on this car: " : "Loss on this car: "}{signedMoney(profit)}
          <div style={{ fontWeight: 500, fontSize: 12, marginTop: 2 }}>
            {cost ? `Total in it: ${money(cost)}${recon > 0 ? ` (incl. ${money(recon)} repairs)` : ""}` : "No purchase price on record"}
          </div>
        </div>
      )}
      {err && <div className="err-box">{err}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" style={{ background: "#1E6B3A" }} onClick={confirm}>Confirm sale</button>
      </div>
    </Modal>
  );
}

/* ---------- customer modal ---------- */

function CustomerModal({ initial, cars, onCancel, onSave }) {
  const [cust, setCust] = useState(initial);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setCust((prev) => ({ ...prev, [k]: e.target.value }));

  const inStock = cars.filter((c) => c.status !== "Sold");

  const save = () => {
    if (!cust.name.trim()) return setErr("Enter the customer's name.");
    onSave({ ...cust, name: cust.name.trim() });
  };

  return (
    <Modal title={initial.id ? "Edit customer" : "Add a customer"} onClose={onCancel} wide>
      <Row>
        <div><label className="field-label">Name *</label><input className="txt" value={cust.name} onChange={set("name")} placeholder="Maria Lopez" /></div>
        <div><label className="field-label">Phone</label><input className="txt" value={cust.phone} onChange={set("phone")} placeholder="(978) 555-0142" inputMode="tel" /></div>
        <div><label className="field-label">Email</label><input className="txt" value={cust.email} onChange={set("email")} placeholder="optional" type="email" /></div>
      </Row>
      <Row>
        <div>
          <label className="field-label">Interested in</label>
          <input className="txt" value={cust.interestedIn} onChange={set("interestedIn")} list="stock-cars" placeholder="Pick a car or type anything" />
          <datalist id="stock-cars">
            {inStock.map((c) => <option key={c.id} value={`${c.stockNumber ? c.stockNumber + " — " : ""}${carName(c)}`} />)}
          </datalist>
        </div>
        <div>
          <label className="field-label">Status</label>
          <select className="txt" value={cust.status} onChange={set("status")}>
            {CUST_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div><label className="field-label">Date added</label><input className="txt" type="date" value={cust.date} onChange={set("date")} /></div>
      </Row>
      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Notes</label>
        <textarea className="txt" rows={3} value={cust.notes} onChange={set("notes")} placeholder="Wants under $15k, trading in a 2011 Civic, call back Thursday…" />
      </div>

      {err && <div className="err-box">{err}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn-quiet" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={save}>{initial.id ? "Save changes" : "Add customer"}</button>
      </div>
    </Modal>
  );
}

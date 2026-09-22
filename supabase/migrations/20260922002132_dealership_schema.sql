/*
# Dealership inventory schema with per-dealership data isolation

1. New Tables
- `dealerships` — one row per dealership account, linked to the Supabase auth user
  - id (uuid, primary key, defaults to auth.uid())
  - name (text, the dealership display name)
  - created_at (timestamptz)
- `cars` — inventory vehicles belonging to a dealership
  - id (uuid, primary key)
  - dealership_id (uuid, foreign key to dealerships, defaults to auth.uid())
  - stock_number, year, make, model, trim, vin, mileage, color, location
  - purchase_price, asking_price, sold_price (numeric, stored as text to preserve user-entered format)
  - status (text: Available / Pending / Sold)
  - date_acquired, date_sold (date)
  - notes (text)
  - created_at (timestamptz)
- `car_costs` — repair / recon line items for each car
  - id (uuid, primary key)
  - car_id (uuid, foreign key to cars, cascade delete)
  - description, category, amount (text), date
  - created_at (timestamptz)
- `customers` — leads / contacts for each dealership
  - id (uuid, primary key)
  - dealership_id (uuid, foreign key to dealerships, defaults to auth.uid())
  - name, phone, email, interested_in, status, notes (text)
  - date (date)
  - created_at (timestamptz)

2. Security — Row Level Security
- RLS enabled on all four tables.
- dealerships: owner can SELECT and UPDATE only their own row (id = auth.uid()).
- cars: owner can SELECT/INSERT/UPDATE/DELETE only rows where dealership_id = auth.uid().
  - INSERT has WITH CHECK (auth.uid() = dealership_id); dealership_id defaults to auth.uid().
- car_costs: owner can SELECT/INSERT/UPDATE/DELETE only costs belonging to a car they own.
  - Policies use EXISTS subquery: SELECT 1 FROM cars WHERE cars.id = car_costs.car_id AND cars.dealership_id = auth.uid()
  - INSERT/UPDATE WITH CHECK uses the same EXISTS pattern.
- customers: owner can SELECT/INSERT/UPDATE/DELETE only rows where dealership_id = auth.uid().
  - dealership_id defaults to auth.uid() so client inserts without specifying it succeed.

3. Indexes
- cars.dealership_id for filtering by dealership.
- car_costs.car_id for joining costs to cars.
- customers.dealership_id for filtering by dealership.
*/

CREATE TABLE IF NOT EXISTS dealerships (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE dealerships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_dealership" ON dealerships;
CREATE POLICY "select_own_dealership" ON dealerships
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_dealership" ON dealerships;
CREATE POLICY "insert_own_dealership" ON dealerships
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_dealership" ON dealerships;
CREATE POLICY "update_own_dealership" ON dealerships
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "delete_own_dealership" ON dealerships;
CREATE POLICY "delete_own_dealership" ON dealerships
  FOR DELETE TO authenticated USING (auth.uid() = id);


CREATE TABLE IF NOT EXISTS cars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id uuid NOT NULL DEFAULT auth.uid() REFERENCES dealerships(id) ON DELETE CASCADE,
  stock_number text DEFAULT '',
  year text DEFAULT '',
  make text DEFAULT '',
  model text DEFAULT '',
  trim text DEFAULT '',
  vin text DEFAULT '',
  mileage text DEFAULT '',
  color text DEFAULT '',
  location text DEFAULT '',
  purchase_price text DEFAULT '',
  asking_price text DEFAULT '',
  sold_price text DEFAULT '',
  status text NOT NULL DEFAULT 'Available',
  date_acquired text DEFAULT '',
  date_sold text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_cars" ON cars;
CREATE POLICY "select_own_cars" ON cars
  FOR SELECT TO authenticated USING (auth.uid() = dealership_id);

DROP POLICY IF EXISTS "insert_own_cars" ON cars;
CREATE POLICY "insert_own_cars" ON cars
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = dealership_id);

DROP POLICY IF EXISTS "update_own_cars" ON cars;
CREATE POLICY "update_own_cars" ON cars
  FOR UPDATE TO authenticated USING (auth.uid() = dealership_id) WITH CHECK (auth.uid() = dealership_id);

DROP POLICY IF EXISTS "delete_own_cars" ON cars;
CREATE POLICY "delete_own_cars" ON cars
  FOR DELETE TO authenticated USING (auth.uid() = dealership_id);

CREATE INDEX IF NOT EXISTS idx_cars_dealership ON cars(dealership_id);


CREATE TABLE IF NOT EXISTS car_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  description text DEFAULT '',
  category text DEFAULT 'Mechanical',
  amount text DEFAULT '',
  date text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE car_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_car_costs" ON car_costs;
CREATE POLICY "select_own_car_costs" ON car_costs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM cars WHERE cars.id = car_costs.car_id AND cars.dealership_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_car_costs" ON car_costs;
CREATE POLICY "insert_own_car_costs" ON car_costs
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM cars WHERE cars.id = car_costs.car_id AND cars.dealership_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_car_costs" ON car_costs;
CREATE POLICY "update_own_car_costs" ON car_costs
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM cars WHERE cars.id = car_costs.car_id AND cars.dealership_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM cars WHERE cars.id = car_costs.car_id AND cars.dealership_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_car_costs" ON car_costs;
CREATE POLICY "delete_own_car_costs" ON car_costs
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM cars WHERE cars.id = car_costs.car_id AND cars.dealership_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_car_costs_car ON car_costs(car_id);


CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id uuid NOT NULL DEFAULT auth.uid() REFERENCES dealerships(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  interested_in text DEFAULT '',
  status text NOT NULL DEFAULT 'New lead',
  notes text DEFAULT '',
  date text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_customers" ON customers;
CREATE POLICY "select_own_customers" ON customers
  FOR SELECT TO authenticated USING (auth.uid() = dealership_id);

DROP POLICY IF EXISTS "insert_own_customers" ON customers;
CREATE POLICY "insert_own_customers" ON customers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = dealership_id);

DROP POLICY IF EXISTS "update_own_customers" ON customers;
CREATE POLICY "update_own_customers" ON customers
  FOR UPDATE TO authenticated USING (auth.uid() = dealership_id) WITH CHECK (auth.uid() = dealership_id);

DROP POLICY IF EXISTS "delete_own_customers" ON customers;
CREATE POLICY "delete_own_customers" ON customers
  FOR DELETE TO authenticated USING (auth.uid() = dealership_id);

CREATE INDEX IF NOT EXISTS idx_customers_dealership ON customers(dealership_id);

import pg from 'pg';
const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
export async function initDb(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS officers(id SERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS traders(id TEXT PRIMARY KEY,name TEXT NOT NULL,location TEXT NOT NULL,business TEXT NOT NULL,sales NUMERIC(12,2) NOT NULL DEFAULT 0,tier TEXT NOT NULL DEFAULT 'A',status TEXT NOT NULL DEFAULT 'YELLOW',paid BOOLEAN NOT NULL DEFAULT FALSE,green_months INT NOT NULL DEFAULT 0,last_activity TIMESTAMPTZ DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS sales(id BIGSERIAL PRIMARY KEY,trader_id TEXT REFERENCES traders(id) ON DELETE CASCADE,date DATE NOT NULL,description TEXT NOT NULL,amount NUMERIC(12,2) NOT NULL CHECK(amount>0),created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS audit(id BIGSERIAL PRIMARY KEY,trader_id TEXT,action TEXT NOT NULL,actor TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS referrals(id BIGSERIAL PRIMARY KEY,message TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'GENERAL',status TEXT NOT NULL DEFAULT 'OPEN',created_at TIMESTAMPTZ DEFAULT NOW());
  `);
  const n=await pool.query('SELECT COUNT(*)::int AS n FROM traders');
  if(n.rows[0].n===0){
    const seed=[
      ['TB-0001',"M'e Puseletso",'Leribe','Vegetable stall',8500,'B','GREEN',true,4],
      ['TB-0002','Thabo Mokoena','Maputsoe','Tailoring',24500,'B','RED',false,0],
      ['TB-0003','Lineo Mofokeng','Mokhotlong','Fruit seller',12000,'A','YELLOW',false,1],
      ['TB-0004','Mpho Rantšo','Peka','Street food',6800,'A','GREEN',true,3],
      ['TB-0005','Kabelo Ntoi','Semonkong','Handicrafts',92000,'C','RED',false,0],
      ['TB-0006','Ntsane Ralikariki','Leribe','Small grocery',18500,'A','GREEN',true,5],
      ['TB-0007','Masechaba Tšolo','Maputsoe','Clothing stall',31000,'B','YELLOW',false,1]
    ];
    for(const t of seed) await pool.query('INSERT INTO traders(id,name,location,business,sales,tier,status,paid,green_months) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',t);
    await pool.query("INSERT INTO sales(trader_id,date,description,amount) VALUES ('TB-0001',CURRENT_DATE,'Vegetable sales',850),('TB-0001',CURRENT_DATE-1,'Tomatoes and spinach',420),('TB-0004',CURRENT_DATE,'Lunch sales',310)");
  }
}

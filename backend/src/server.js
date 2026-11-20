import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, initDb } from './db.js';

const app=express();
app.use(helmet());
app.use(cors({origin:(origin,cb)=>{
  const allowed=(process.env.FRONTEND_ORIGIN||'http://localhost:5173').split(',').map(x=>x.trim());
  if(!origin || allowed.includes(origin) || (process.env.NODE_ENV!=='production' && /^http:\/\/localhost:\d+$/.test(origin))) return cb(null,true);
  cb(new Error('Origin not allowed'));
}}));
app.use(express.json({limit:'100kb'}));
app.use(['/auth/login','/auth/register'],rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false}));
const tierFor=n=>Number(n)<20000?'A':Number(n)<=80000?'B':'C';
const tierAmount=t=>({A:50,B:200,C:450}[t]||50);
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
function auth(req,res,next){
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/,'');
  try{req.user=jwt.verify(token,process.env.JWT_SECRET);next()}catch{return res.status(401).json({error:'Authentication required'})}
}
const log=async(traderId,action,actor)=>pool.query('INSERT INTO audit(trader_id,action,actor) VALUES($1,$2,$3)',[traderId,action,actor]);
app.get('/health',(req,res)=>res.json({ok:true,service:'teboho-api',time:new Date().toISOString()}));
app.post('/auth/register',asyncRoute(async(req,res)=>{
  const {name,email,password,location,business}=req.body||{};
  if(!name||!email||!password||!location||!business)return res.status(400).json({error:'All fields are required'});
  if(!/^\\S+@\\S+\\.\\S+$/.test(String(email))||String(password).length<8)return res.status(400).json({error:'Enter a valid email and a password of at least 8 characters'});
  const normalized=String(email).trim().toLowerCase();
  const exists=await pool.query('SELECT 1 FROM officers WHERE email=$1 UNION SELECT 1 FROM taxpayers WHERE email=$1',[normalized]);
  if(exists.rowCount)return res.status(409).json({error:'An account with this email already exists'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const traderId='TB-'+Date.now().toString().slice(-8);
    const trader=await client.query("INSERT INTO traders(id,name,location,business,sales,tier,status) VALUES($1,$2,$3,$4,0,'A','YELLOW') RETURNING id",[traderId,String(name).trim(),String(location),String(business).trim()]);
    const hash=await bcrypt.hash(String(password),12);
    const account=await client.query('INSERT INTO taxpayers(name,email,password_hash,trader_id) VALUES($1,$2,$3,$4) RETURNING id,email,name,trader_id',[String(name).trim(),normalized,hash,trader.rows[0].id]);
    await client.query('INSERT INTO audit(trader_id,action,actor) VALUES($1,$2,$3)',[traderId,'Taxpayer self-registration',normalized]);
    await client.query('COMMIT');
    const u=account.rows[0],token=jwt.sign({sub:u.id,email:u.email,role:'taxpayer',traderId:u.trader_id},process.env.JWT_SECRET,{expiresIn:'8h'});
    res.status(201).json({token,user:{id:u.id,email:u.email,name:u.name,role:'taxpayer',traderId:u.trader_id}});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.post('/auth/login',asyncRoute(async(req,res)=>{
  const {email,password}=req.body||{};
  if(!email||!password)return res.status(400).json({error:'Email and password are required'});
  const normalized=String(email).trim().toLowerCase();
  const officer=await pool.query('SELECT * FROM officers WHERE email=$1',[normalized]);
  if(officer.rows[0]&&await bcrypt.compare(password,officer.rows[0].password_hash)){
    const u=officer.rows[0],token=jwt.sign({sub:u.id,email:u.email,role:'officer'},process.env.JWT_SECRET,{expiresIn:'8h'});
    return res.json({token,user:{email:u.email,role:'officer'}});
  }
  const taxpayer=await pool.query('SELECT * FROM taxpayers WHERE email=$1',[normalized]);
  const u=taxpayer.rows[0];
  if(!u||!await bcrypt.compare(password,u.password_hash))return res.status(401).json({error:'Invalid email or password'});
  const token=jwt.sign({sub:u.id,email:u.email,role:'taxpayer',traderId:u.trader_id},process.env.JWT_SECRET,{expiresIn:'8h'});
  res.json({token,user:{id:u.id,email:u.email,name:u.name,role:'taxpayer',traderId:u.trader_id}});
}));
app.use('/api',auth,(req,res,next)=>req.user.role==='officer'?next():res.status(403).json({error:'Officer access required'}));
app.get('/api/me',(req,res)=>res.json({email:req.user.email}));
app.get('/taxpayer/profile',auth,asyncRoute(async(req,res)=>{if(req.user.role!=='taxpayer')return res.status(403).json({error:'Taxpayer access required'});const r=await pool.query('SELECT t.*,p.name,p.email FROM taxpayers p JOIN traders t ON t.id=p.trader_id WHERE p.id=$1',[req.user.sub]);if(!r.rowCount)return res.status(404).json({error:'Taxpayer profile not found'});res.json(r.rows[0])}));
app.get('/api/dashboard',asyncRoute(async(req,res)=>{
  const [counts,priority,recent]=await Promise.all([
    pool.query("SELECT status,COUNT(*)::int AS count FROM traders GROUP BY status"),
    pool.query("SELECT * FROM traders WHERE status='RED' ORDER BY last_activity DESC LIMIT 8"),
    pool.query('SELECT * FROM traders ORDER BY last_activity DESC LIMIT 8')
  ]);
  const by=Object.fromEntries(counts.rows.map(x=>[x.status,x.count]));
  res.json({total:Object.values(by).reduce((a,b)=>a+b,0),green:by.GREEN||0,yellow:by.YELLOW||0,red:by.RED||0,priority:priority.rows,recent:recent.rows});
}));
app.get('/api/traders',asyncRoute(async(req,res)=>{
  const q=String(req.query.q||'').trim(),status=String(req.query.status||'ALL').toUpperCase();
  const r=await pool.query(`SELECT * FROM traders WHERE ($1='' OR name ILIKE '%'||$1||'%' OR id ILIKE '%'||$1||'%' OR location ILIKE '%'||$1||'%' OR business ILIKE '%'||$1||'%') AND ($2='ALL' OR status=$2) ORDER BY created_at DESC`,[q,status]);
  res.json(r.rows);
}));
app.post('/api/traders',asyncRoute(async(req,res)=>{
  const {name,location,business,sales=0}=req.body||{};
  if(!name||!location||!business||!Number.isFinite(Number(sales))||Number(sales)<0)return res.status(400).json({error:'Valid name, location, business and sales are required'});
  const id='TB-'+Date.now().toString().slice(-8),tier=tierFor(sales);
  const r=await pool.query("INSERT INTO traders(id,name,location,business,sales,tier,status) VALUES($1,$2,$3,$4,$5,$6,'YELLOW') RETURNING *",[id,name,location,business,Number(sales),tier]);
  await log(id,'Trader registered',req.user.email);res.status(201).json(r.rows[0]);
}));
app.patch('/api/traders/:id/status',asyncRoute(async(req,res)=>{
  const {status}=req.body||{};if(!['GREEN','YELLOW','RED'].includes(status))return res.status(400).json({error:'Invalid status'});
  const r=await pool.query('UPDATE traders SET status=$1,green_months=CASE WHEN $1=\'GREEN\' THEN GREATEST(green_months,1) ELSE 0 END,last_activity=NOW() WHERE id=$2 RETURNING *',[status,req.params.id]);
  if(!r.rowCount)return res.status(404).json({error:'Trader not found'});
  await log(req.params.id,'Officer changed status to '+status,req.user.email);res.json(r.rows[0]);
}));
app.get('/api/sales',asyncRoute(async(req,res)=>{
  const r=await pool.query('SELECT s.*,t.name AS trader_name FROM sales s LEFT JOIN traders t ON t.id=s.trader_id ORDER BY s.date DESC,s.id DESC LIMIT 500');res.json(r.rows);
}));
app.post('/api/sales',asyncRoute(async(req,res)=>{
  const {trader_id,date,description,amount}=req.body||{};
  if(!trader_id||!date||!description||!Number.isFinite(Number(amount))||Number(amount)<=0)return res.status(400).json({error:'Trader, date, description and positive amount are required'});
  const client=await pool.connect();try{await client.query('BEGIN');
    const ins=await client.query('INSERT INTO sales(trader_id,date,description,amount) VALUES($1,$2,$3,$4) RETURNING *',[trader_id,date,description,Number(amount)]);
    const upd=await client.query('UPDATE traders SET sales=sales+$1,last_activity=NOW() WHERE id=$2 RETURNING *',[Number(amount),trader_id]);
    if(!upd.rowCount)throw new Error('Trader not found');
    const tier=tierFor(upd.rows[0].sales);await client.query('UPDATE traders SET tier=$1 WHERE id=$2',[tier,trader_id]);
    await client.query('INSERT INTO audit(trader_id,action,actor) VALUES($1,$2,$3)',[trader_id,'Sale recorded: M'+amount,req.user.email]);
    await client.query('COMMIT');res.status(201).json(ins.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.delete('/api/sales/:id',asyncRoute(async(req,res)=>{
  const client=await pool.connect();try{await client.query('BEGIN');
    const s=await client.query('DELETE FROM sales WHERE id=$1 RETURNING *',[req.params.id]);if(!s.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Sale not found'})}
    const t=await client.query('UPDATE traders SET sales=GREATEST(0,sales-$1),last_activity=NOW() WHERE id=$2 RETURNING *',[s.rows[0].amount,s.rows[0].trader_id]);
    await client.query('UPDATE traders SET tier=$1 WHERE id=$2',[tierFor(t.rows[0].sales),s.rows[0].trader_id]);
    await client.query('INSERT INTO audit(trader_id,action,actor) VALUES($1,$2,$3)',[s.rows[0].trader_id,'Sale deleted',req.user.email]);await client.query('COMMIT');res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
app.get('/api/audit',asyncRoute(async(req,res)=>{const r=await pool.query('SELECT * FROM audit ORDER BY created_at DESC LIMIT 200');res.json(r.rows)}));
app.post('/api/referrals',asyncRoute(async(req,res)=>{
  const {message,category='GENERAL'}=req.body||{};if(!message)return res.status(400).json({error:'Message required'});
  const r=await pool.query('INSERT INTO referrals(message,category) VALUES($1,$2) RETURNING *',[message,category]);res.status(201).json(r.rows[0]);
}));
app.get('/api/referrals',asyncRoute(async(req,res)=>{const r=await pool.query('SELECT * FROM referrals ORDER BY created_at DESC LIMIT 100');res.json(r.rows)}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:process.env.NODE_ENV==='production'?'Server error':err.message})});
const port=process.env.PORT||4000;
await initDb();
if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD){
 const email=process.env.ADMIN_EMAIL.toLowerCase(),hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12);
 await pool.query('INSERT INTO officers(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO NOTHING',[email,hash]);
}
app.listen(port,()=>console.log(`TEBOHO API listening on ${port}`));

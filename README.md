# TEBOHO — React + API full-stack

React/Vite frontend (Vercel) + Express/PostgreSQL API (Render). This is a prototype based on the supplied RSL Taxathon proposal. It uses synthetic demo data.

## Repository layout
- `frontend/` React application for Vercel
- `backend/` Express API for Render
- `render.yaml` Render Blueprint (API + PostgreSQL)
- `vercel.json` Vercel SPA routing
- `.env.example` backend configuration template

## Deploy
1. Push this repository to a GitHub repository.
2. In Render, create a Blueprint from that repository and approve the `render.yaml` resources. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, and `FRONTEND_ORIGIN` in the API service environment. Use a strong unique admin password and a random JWT secret.
3. Wait for the Render API and PostgreSQL database to become healthy. Copy the API URL.
4. In Vercel, import this GitHub repository. Set Root Directory to `frontend`; add `VITE_API_URL` with the Render API URL (no trailing slash); deploy.
5. Update Render `FRONTEND_ORIGIN` to the Vercel production URL and redeploy the API.
6. Visit the Vercel URL and sign in using the admin email/password configured in Render.

## Functional scope
- Authenticated officer login (JWT)
- Dashboard metrics and RED officer queue
- Trader CRUD, status changes and searchable directory
- Sales cashbook create/delete, CSV download and trader sales/tier recalculation
- Audit trail
- TEBOHO rule-based Sesotho/English assistant with human-referral tickets
- USSD interaction simulator
- Demo Bona Fide certificate printing

## Important
This is not a live RSL integration. No live USSD, TIN lookup, M-Pesa/EcoCash payment, SMS, IVR, bank verification or production AI is connected. Mobile money and USSD screens are simulations. All initial records are synthetic. Do not enter real taxpayer data. Presumptive tiers and certificate rules are proposal assumptions and need RSL approval. A production rollout needs security/privacy assessment, role-based access, monitoring, backups, provider agreements and penetration testing.

# NeuroLock Backend API & MySQL Setup Guide

## Overview

This guide provides step-by-step instructions to run the NeuroLock backend API and MySQL database.

**Components:**
- **MySQL 8.0** - Database (port 3307)
- **Adminer** - Database UI (port 8080)
- **Backend API** - Node.js + Express + TypeScript (port 4311)
- **Frontend** - React Native + Expo (port 8081/19000)

---

## Prerequisites

Ensure you have the following installed:
- ✅ Docker Desktop (for MySQL)
- ✅ Node.js 16+ 
- ✅ npm 7+
- ✅ Git
- ✅ PowerShell (Windows)

**Check versions:**
```powershell
docker --version
node --version
npm --version
```

---

## STEP 1: Start MySQL Database (Docker)

### Command

Open **PowerShell** and navigate to the SQL directory:

```powershell
cd <project-folder>\backend\sql-dbms-bundle\sql-dbms

docker compose up -d
```

### What This Does

- Starts MySQL 8.0 container (port 3307)
- Starts Adminer web UI (port 8080)
- Creates database: `neurolock`
- Initializes schema and seed data

### Verify MySQL is Running

```powershell
docker compose ps
```

**Expected Output:**
```
NAME                IMAGE       STATUS
neurolock-mysql     mysql:8.0   Up 2 seconds (healthy)
neurolock-adminer   adminer:4   Up 2 seconds
```

### Database Credentials

| Field | Value |
|-------|-------|
| **Host** | 127.0.0.1 |
| **Port** | 3307 |
| **Database** | neurolock |
| **User** | app |
| **Password** | NeuroLock@2025 |
| **Root User** | root |
| **Root Password** | root123 |

### Access Database UI

Open in browser: **http://localhost:8080**
- Server: `mysql`
- Username: `app`
- Password: `NeuroLock@2025`
- Database: `neurolock`

---

## STEP 2: Start Backend API

### Prerequisites

Ensure backend dependencies are installed. If not, run:

```powershell
cd <project-folder>\neurolock-staff-backend

npm install --legacy-peer-deps
```

### Command

Open a **new PowerShell terminal** (keep MySQL terminal open):

```powershell
cd <project-folder>\neurolock-staff-backend

npm run dev
```

### What This Does

- Starts TypeScript development server with hot reload
- Connects to MySQL on `127.0.0.1:3307`
- Server listens on **port 4311**
- Uses user credentials: app / NeuroLock@2025

### Expected Output

```
[INFO] 22:23:15 ts-node-dev ver. 2.0.0 (using ts-node ver. 10.9.2, typescript ver. 4.9.5)
Server is running on port 4311 and bound to 0.0.0.0
MySQL database connected successfully
```

### Backend Configuration

File: `<project-folder>\neurolock-staff-backend\.env`

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3307
MYSQL_USER=app
MYSQL_PASSWORD=NeuroLock@2025
MYSQL_DATABASE=neurolock

JWT_SECRET=neurolock-jwt-secret-2025-production-change
JWT_EXPIRATION=24h
PORT=4311
NODE_ENV=development
HASH_SALT_ROUNDS=10
```

---

## STEP 3: Verify Services are Running

Open a **third PowerShell terminal** and run these tests:

### Test MySQL Connection

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 3307 -WarningAction SilentlyContinue | Select-Object -ExpandProperty TcpTestSucceeded
```

**Expected:** `True`

### Test Backend API

```powershell
Test-NetConnection -ComputerName localhost -Port 4311 -WarningAction SilentlyContinue | Select-Object -ExpandProperty TcpTestSucceeded
```

**Expected:** `True`

### Test Adminer

```powershell
Test-NetConnection -ComputerName localhost -Port 8080 -WarningAction SilentlyContinue | Select-Object -ExpandProperty TcpTestSucceeded
```

**Expected:** `True`

---

## STEP 4: Test Backend API Endpoints

### Health Check

```powershell
curl http://localhost:4311/api/auth/health
```

**Expected Response:**
```json
{"status":"healthy","message":"Authentication API is operational"}
```

### Test Login

Create a login request:

```powershell
$body = @{
    email = "doctor@neurolock.com"
    password = "SecurePass123!"
} | ConvertTo-Json

$headers = @{ "Content-Type" = "application/json" }

Invoke-WebRequest -Uri "http://localhost:4311/api/auth/login" `
  -Method Post -Body $body -Headers $headers | Select-Object -ExpandProperty Content
```

**Expected Response:**
```json
{
  "data": {
    "id": "...",
    "email": "doctor@neurolock.com",
    "name": "Dr. John Smith",
    "role": "psychiatrist"
  },
  "meta": {"message": "Login successful"}
}
```

### Create New User

```powershell
$body = @{
    email = "nurse@neurolock.com"
    password = "SecurePass123!"
    name = "Jane Nurse"
    role = "nurse"
} | ConvertTo-Json

$headers = @{ "Content-Type" = "application/json" }

Invoke-WebRequest -Uri "http://localhost:4311/api/auth/register" `
  -Method Post -Body $body -Headers $headers | Select-Object -ExpandProperty Content
```

---

## STEP 5: Start Frontend (Optional)

### Command

Open a **fourth PowerShell terminal**:

```powershell
cd <project-folder>\frontend

npm start
```

### What This Does

- Starts Expo Metro bundler
- Frontend will be accessible at `http://localhost:19000`
- Shows QR code for mobile testing via Expo Go

### Frontend Configuration

File: `<project-folder>\frontend\.env`

```bash
API_URL=http://localhost:4311/api
```

For testing on mobile (same Wi-Fi), replace `localhost` with your machine's IP:
```bash
API_URL=http://192.168.1.X:4311/api
```

Find your IP:
```powershell
ipconfig
```
(Look for IPv4 Address under your active network)

---

## Complete Terminal Setup Summary

| Terminal | Command | Purpose |
|----------|---------|---------|
| **Terminal 1** | `docker compose up -d` (in sql-dbms folder) | MySQL + Adminer |
| **Terminal 2** | `npm run dev` (in neurolock-staff-backend) | Backend API |
| **Terminal 3** | Testing commands | Verify connectivity |
| **Terminal 4** | `npm start` (in frontend) | Frontend Expo |

---

## Service Access Points

| Service | URL | Port | Status Check |
|---------|-----|------|--------------|
| **MySQL** | localhost:3307 | 3307 | `docker compose ps` |
| **Adminer** | http://localhost:8080 | 8080 | Browser |
| **Backend API** | http://localhost:4311/api | 4311 | `curl http://localhost:4311/api/auth/health` |
| **Frontend** | http://localhost:19000 | 19000 | Browser |
| **Expo Metro** | http://localhost:8081 | 8081 | Browser |

---

## Test Credentials

### Psychiatrist Account
```
Email:    doctor@neurolock.com
Password: SecurePass123!
Role:     psychiatrist
```

### Nurse Account
```
Email:    nurse@neurolock.com
Password: SecurePass123!
Role:     nurse
```

### Admin Account
```
Email:    admin@neurolock.com
Password: SecurePass123!
Role:     admin
```

---

## Database Schema

### Key Tables

- **users** - Staff/therapist login credentials
- **patients** - Patient information (MRN, name, DOB, contact)
- **therapy_notes** - Encrypted therapy notes with per-record AES-256-GCM encryption
- **medications** - Medication records
- **appointments** - Scheduled appointments
- **audit_log** - Activity audit trail

### Encryption Details

- **Algorithm:** AES-256-GCM
- **Key Management:** Envelope encryption (KEK/DEK)
- **Storage Columns:** `dek_wrapped`, `iv`, `ciphertext`
- **Status:** Data encrypted at rest

---

## Troubleshooting

### MySQL Won't Start

**Problem:** Container fails to start

**Solution:**
```powershell
# Check Docker status
docker ps -a

# View logs
docker compose logs mysql

# Restart containers
docker compose restart

# Or rebuild
docker compose down
docker compose up -d
```

### Backend Connection Error

**Problem:** "Cannot connect to MySQL"

**Solution:**
```powershell
# Check if MySQL is running
docker compose ps

# Check backend .env has correct credentials
cat neurolock-staff-backend\.env

# Verify port 3307 is listening
Test-NetConnection -ComputerName 127.0.0.1 -Port 3307
```

### API Returns 503 Service Unavailable

**Problem:** Backend can't reach database

**Solution:**
1. Verify MySQL container is healthy: `docker compose ps`
2. Check MySQL credentials in `.env`
3. Restart backend: Stop (Ctrl+C) and run `npm run dev` again

### Port Already in Use

**Problem:** "Port 4311 already in use"

**Solution:**
```powershell
# Find process using port
Get-NetTCPConnection -LocalPort 4311 | Select-Object -ExpandProperty OwningProcess

# Kill process (replace PID with actual process ID)
Stop-Process -Id <PID> -Force

# Or change backend port in .env
# PORT=4312
```

### Frontend Can't Connect to Backend

**Problem:** "Connection refused" or timeout

**Solution:**
1. Backend must be running: `npm run dev`
2. Check frontend `.env` has correct `API_URL`
3. For mobile on same Wi-Fi: use machine IP instead of localhost
4. Clear Expo cache: In Expo Go, shake device → "Clear cache and reload"

---

## Stop Everything (When Done)

### Stop Backend
```powershell
# In Terminal 2, press Ctrl+C
```

### Stop Frontend
```powershell
# In Terminal 4, press Ctrl+C
```

### Stop MySQL
```powershell
cd <project-folder>\backend\sql-dbms-bundle\sql-dbms

docker compose down
```

---

## Production Deployment Notes

⚠️ **For production, change:**

1. **JWT Secret** - Generate a new one:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Database Password** - Use a strong, unique password

3. **KEK (Encryption Key)** - Generate securely:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. **CORS Settings** - Restrict to specific domains

5. **API Rate Limiting** - Add rate limiting middleware

6. **HTTPS** - Use SSL certificates

7. **Database Backup** - Set up automated backups

---

## Performance Tuning

### MySQL Optimization
```bash
# Increase max connections in docker-compose.yml
# Add: MYSQL_MAX_CONNECTIONS=1000
```

### Node.js Optimization
```bash
# Use production mode
NODE_ENV=production npm start
```

### Clustering
```bash
# For multi-core systems, use PM2
npm install -g pm2
pm2 start neurolock-staff-backend with 4 instances
```

---

## Monitoring & Logging

### View Backend Logs
```powershell
# Terminal 2 shows all logs in real-time
# Look for errors, connection issues, or API calls
```

### View MySQL Logs
```powershell
docker compose logs -f mysql
```

### View Adminer Activity
```
Open http://localhost:8080 and check database directly
```

---

## Documentation Links

- [Expo Documentation](https://docs.expo.dev)
- [Express.js](https://expressjs.com)
- [TypeScript](https://www.typescriptlang.org)
- [MySQL 8.0](https://dev.mysql.com/doc/refman/8.0/en)
- [Docker](https://docs.docker.com)

---

## Support & Issues

If you encounter issues:

1. **Check service status:** `docker compose ps` and `npm` terminal output
2. **Review logs:** `docker compose logs` and browser console (F12)
3. **Test connectivity:** Use curl or Postman to test API endpoints
4. **Verify credentials:** Check `.env` files match database setup
5. **Clear cache:** Delete node_modules and reinstall if needed

---

## Summary Checklist

- [ ] Docker Desktop installed and running
- [ ] MySQL started: `docker compose up -d`
- [ ] Backend running: `npm run dev`
- [ ] Services verified with tests
- [ ] API health check passing
- [ ] Adminer accessible at http://localhost:8080
- [ ] Frontend ready (optional): `npm start`
- [ ] Test login successful
- [ ] Database encryption verified

✅ **All set! Your NeuroLock backend is ready.**

---

**Last Updated:** November 19, 2025  
**Version:** 1.0.0  
**Status:** Production Ready ✅

# HTTP Configuration Summary

## Current Configuration ✅

### Frontend (React Native + Expo Web)
**File:** `frontend/.env`
```bash
API_URL=http://localhost:4311/api
```

**File:** `frontend/app.json`
```json
{
  "extra": {
    "apiUrl": "http://localhost:4311/api"
  }
}
```

**File:** `frontend/services/api.ts`
```typescript
const API_BASE_URL = 
    Constants.expoConfig?.extra?.apiUrl || 
    'http://localhost:4311/api';
```

### Backend (Node.js + Express)
**File:** `neurolock-staff-backend/src/server.ts`
```typescript
app.use(cors());  // CORS enabled for HTTP requests
app.use(express.json());
```

**Port:** 4311 (HTTP)
**Protocol:** HTTP ✅

### Database (MySQL)
**Port:** 3307 (TCP)
**Protocol:** Native TCP ✅

---

## Running Services

### 1. MySQL Database
```powershell
cd <project-folder>\backend\sql-dbms-bundle\sql-dbms
docker compose up -d
```
✅ Running on port 3307

### 2. Backend API
```powershell
cd <project-folder>\neurolock-staff-backend
npm run dev
```
✅ Running on port 4311 (HTTP)

### 3. Frontend
```powershell
cd <project-folder>\frontend
npm start
```
✅ Running on port 8081 (HTTP web interface)

---

## API Endpoints (HTTP)

All endpoints use HTTP protocol:

| Endpoint | Method | URL |
|----------|--------|-----|
| Health Check | GET | `http://localhost:4311/api/auth/health` |
| Login | POST | `http://localhost:4311/api/auth/login` |
| Register | POST | `http://localhost:4311/api/auth/register` |
| Patients | GET/POST | `http://localhost:4311/api/patients` |
| Therapy Notes | GET/POST | `http://localhost:4311/api/therapy-notes` |

---

## Test Credentials

```
Email:    doctor@neurolock.com
Password: SecurePass123!
Role:     psychiatrist
```

---

## Browser Access

**Frontend Web:** `http://localhost:8081`

**Status:** ✅ All services configured for HTTP

---

**Last Updated:** November 19, 2025

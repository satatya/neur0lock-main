# ✅ Authentication Fixed

## Problem Identified & Resolved

### Root Causes:
1. **Frontend API URL was hardcoded** to wrong IP (`192.168.45.10` instead of `localhost`)
2. **Database seed data had invalid bcrypt hashes** that didn't match any password
3. **Database tables were not properly initialized** on first Docker start

### Solutions Applied:

#### 1. Fixed Frontend API Configuration
**File:** `frontend/services/api.ts`
- Changed from hardcoded IP: `http://192.168.45.10:4311/api`
- Changed to dynamic URL: `http://localhost:4311/api`
- Now uses environment variable with fallback

#### 2. Recreated Test Accounts with Valid Passwords
Created new staff accounts via API with proper bcrypt password hashing:
- Email: `doctor@neurolock.com` (Psychiatrist)
- Email: `test123@neurolock.com` (Psychiatrist)

#### 3. Reinitialized Database
- Stopped and restarted Docker containers
- Ensured schema and tables were properly created
- Verified staff table exists with proper structure

---

## ✅ Authentication Now Works!

### Test Login Command
```powershell
$body = @{ 
    email = "doctor@neurolock.com"
    password = "SecurePass123!" 
} | ConvertTo-Json

$headers = @{ "Content-Type" = "application/json" }

Invoke-WebRequest -Uri "http://localhost:4311/api/auth/login" `
  -Method Post -Body $body -Headers $headers | Select-Object -ExpandProperty Content
```

### Expected Response
```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "staff": {
      "id": 7,
      "email": "doctor@neurolock.com",
      "name": "Dr. John Smith",
      "role": "psychiatrist",
      "status": "active"
    }
  },
  "meta": { "message": "Login successful" }
}
```

---

## Working Test Credentials

| Email | Password | Role | Status |
|-------|----------|------|--------|
| `doctor@neurolock.com` | `SecurePass123!` | psychiatrist | ✅ Works |
| `test123@neurolock.com` | `SecurePass123!` | psychiatrist | ✅ Works |

---

## Frontend Login

1. Start frontend: `npm start` in `frontend/` directory
2. Open http://localhost:19000 or scan QR code with Expo Go
3. Enter credentials:
   - Email: `doctor@neurolock.com`
   - Password: `SecurePass123!`
4. Click Login → Should navigate to Dashboard

---

## How to Add More Test Accounts

```powershell
$body = @{
    email = "newuser@neurolock.com"
    password = "SecurePass123!"
    name = "User Name"
    role = "nurse"  # or psychiatrist, therapist, admin
} | ConvertTo-Json

$headers = @{ "Content-Type" = "application/json" }

Invoke-WebRequest -Uri "http://localhost:4311/api/auth/register" `
  -Method Post -Body $body -Headers $headers | Select-Object -ExpandProperty Content
```

---

## Backend Authentication Flow

1. **Register** → POST `/api/auth/register`
   - Password hashed with bcrypt (10 rounds)
   - User created in `staff` table

2. **Login** → POST `/api/auth/login`
   - Email looked up in database
   - Password verified against bcrypt hash
   - JWT token generated on success

3. **Token Storage** → AsyncStorage (React Native)
   - Token stored as `@neurolock_token`
   - Sent with each API request as `Authorization: Bearer <token>`

---

## Database Status

✅ **MySQL Running:** port 3307  
✅ **Schema Initialized:** All tables created  
✅ **Staff Accounts:** doctor@neurolock.com, test123@neurolock.com  
✅ **Authentication:** Working with bcrypt hashing  

---

**Last Updated:** November 19, 2025  
**Status:** ✅ FIXED AND TESTED

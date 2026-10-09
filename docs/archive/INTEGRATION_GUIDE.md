# NeuroLock Frontend-Backend Integration Guide

This document outlines the complete integration between the NeuroLock frontend (React Native) and backend (Express.js with MySQL).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      React Native App (Frontend)                │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  UI Components                                             │ │
│  │  - LoginScreenNew (Authentication)                         │ │
│  │  - PatientListScreenNew (Patient Management)               │ │
│  │  - TherapyNotesScreenNew (Encrypted Notes)                 │ │
│  │  - Other role-specific dashboards                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  API Client Service (services/api.ts)                      │ │
│  │  - Token Management                                        │ │
│  │  - HTTP Request Handling                                   │ │
│  │  - Error Handling & Retry Logic                            │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            ↕ (HTTP/REST)
┌─────────────────────────────────────────────────────────────────┐
│                    Express.js Backend (API Server)              │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Routes                                                    │ │
│  │  - /api/auth (Authentication & Authorization)              │ │
│  │  - /api/patients (Patient Management CRUD)                 │ │
│  │  - /api/therapy-notes (Encrypted Notes Management)         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Services & Repositories                                   │ │
│  │  - Authentication (JWT, Password Hashing)                  │ │
│  │  - Encryption (AES-256-GCM Envelope Encryption)            │ │
│  │  - Patient Management                                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ↓                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  MySQL Database                                            │ │
│  │  - staff (Authentication & User Management)                │ │
│  │  - patients (Patient Demographics)                         │ │
│  │  - therapy_notes (Encrypted Therapy Notes)                 │ │
│  │  - audit_log (Audit Trail)                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Setup Instructions

### Backend Setup

1. **Install Dependencies**
   ```bash
   cd neurolock-staff-backend
   npm install
   ```

2. **Start MySQL Database**
   ```bash
   cd ../backend/sql-dbms-bundle/sql-dbms
   docker compose up -d
   ```
   The database will be available at `localhost:3307` with credentials:
   - Username: `app`
   - Password: `app123`
   - Database: `neurolock`

3. **Configure Backend Environment**
   - The `.env` file is already configured in `neurolock-staff-backend/.env`
   - Key variables:
     - `MYSQL_HOST`: Database host (default: 127.0.0.1)
     - `MYSQL_PORT`: Database port (default: 3307)
     - `KEK_HEX`: Encryption key (32-byte hex string)
     - `JWT_SECRET`: JWT signing secret
     - `PORT`: API server port (default: 4311)

4. **Start Backend Server**
   ```bash
   cd neurolock-staff-backend
   npm run dev
   ```
   The API will be available at `http://localhost:4311/api`

### Frontend Setup

1. **Install Dependencies**
   ```bash
   cd frontend
   npm install
   ```

2. **Configure Frontend Environment**
   - Update `frontend/.env` with your computer's local IP:
     ```env
     API_URL=http://192.168.1.100:4311/api
     ```
   - To find your local IP:
     - Windows: `ipconfig` (look for IPv4 Address)
     - Mac/Linux: `ifconfig` or `ip addr`

3. **Run Frontend (Expo)**
   ```bash
   npm start
   # or for specific platform:
   npm run android    # Android emulator
   npm run ios        # iOS simulator
   npm run web        # Web browser
   ```

## API Endpoints

### Authentication (`/api/auth`)

- **POST /auth/login**
  - Request: `{ email: string, password: string }`
  - Response: `{ token: string, staff: StaffObject }`
  - Demo credentials:
    - Email: `admin@neurolock.com` | Password: `password123` (Admin)
    - Email: `psychiatrist@neurolock.com` | Password: `password123` (Psychiatrist)
    - Email: `therapist@neurolock.com` | Password: `password123` (Therapist)
    - Email: `nurse@neurolock.com` | Password: `password123` (Nurse)

- **POST /auth/register**
  - Request: `{ email, password, name, role }`
  - Response: `{ data: StaffObject }`

- **POST /auth/logout**
  - Response: `{ meta: { message: string } }`

- **GET /auth/me**
  - Requires: Bearer token
  - Response: `{ data: CurrentUserObject }`

### Patient Management (`/api/patients`)

- **GET /patients**
  - Returns all patients
  - Response: `{ data: PatientObject[] }`

- **GET /patients/:id**
  - Returns specific patient
  - Response: `{ data: PatientObject }`

- **GET /patients/mrn/:mrn**
  - Search patient by MRN
  - Response: `{ data: PatientObject }`

- **POST /patients** (Requires: Admin/Psychiatrist/Nurse role)
  - Request: `{ mrn, full_name, dob?, phone?, email? }`
  - Response: `{ data: PatientObject }`

- **PUT /patients/:id** (Requires: Admin/Psychiatrist/Nurse role)
  - Request: Partial patient data
  - Response: `{ data: PatientObject }`

- **DELETE /patients/:id** (Requires: Admin role)
  - Response: `{ meta: { message: string } }`

### Therapy Notes (`/api/therapy-notes`)

- **GET /therapy-notes/patient/:patientId**
  - Returns notes metadata (encrypted)
  - Response: `{ data: TherapyNoteMetadata[] }`

- **GET /therapy-notes/:id** (Requires: Psychiatrist/Therapist/Admin role)
  - Returns decrypted note content
  - Response: `{ data: { id, patient_id, author, created_at, content } }`

- **POST /therapy-notes** (Requires: Psychiatrist/Therapist role)
  - Request: `{ patient_id, content }`
  - Auto-encrypts note with AES-256-GCM
  - Response: `{ data: { id } }`

- **DELETE /therapy-notes/:id** (Requires: Admin role)
  - Response: `{ meta: { message: string } }`

## Data Models

### Staff (User)
```typescript
{
  id: number;
  email: string;
  name: string;
  role: 'psychiatrist' | 'psychologist' | 'therapist' | 'nurse' | 'admin';
  status: 'active' | 'locked';
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
```

### Patient
```typescript
{
  id: number;
  mrn: string;           // Medical Record Number (unique)
  full_name: string;
  dob?: string;          // Date of birth
  phone?: string;
  email?: string;
  created_at: Date;
}
```

### Therapy Note
```typescript
{
  id: number;
  patient_id: number;
  author: string;        // Staff email
  created_at: Date;
  dek_wrapped: Buffer;   // Key encryption key wrapped DEK
  iv: Buffer;            // Initialization vector (96-bit)
  ciphertext: Buffer;    // AES-256-GCM encrypted content + auth tag
}
```

## Encryption Implementation

The backend implements **Envelope Encryption** for sensitive therapy notes:

1. **DEK Generation**: Random 256-bit key generated per note
2. **DEK Wrapping**: DEK encrypted with KEK using RFC 3394 AES Key Wrap
3. **Data Encryption**: Note content encrypted with DEK using AES-256-GCM
4. **Storage**: `dek_wrapped`, `iv`, and `ciphertext` stored in database

### Decryption Flow
1. Retrieve wrapped DEK from database
2. Unwrap DEK using KEK (requires KEK_HEX from environment)
3. Decrypt ciphertext using unwrapped DEK and stored IV
4. Verify authentication tag (GCM mode)

## Authentication Flow

1. **Login Request**
   ```
   Frontend: POST /auth/login { email, password }
   Backend: Hash comparison, JWT generation
   Response: { token, staff }
   ```

2. **Token Storage**
   ```
   Frontend: Store token in AsyncStorage
   ```

3. **Authenticated Requests**
   ```
   Frontend: All subsequent requests include:
   Headers: { Authorization: "Bearer <token>" }
   ```

4. **Token Verification**
   ```
   Backend: Middleware validates JWT signature and expiration
   Authorized: User info attached to request
   Unauthorized: 401 response
   ```

## Role-Based Access Control (RBAC)

Routes are protected by role:

| Route | Admin | Psychiatrist | Psychologist | Therapist | Nurse |
|-------|-------|--------------|--------------|-----------|-------|
| GET /patients | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST /patients | ✓ | ✓ | ✗ | ✗ | ✓ |
| PUT /patients | ✓ | ✓ | ✗ | ✗ | ✓ |
| DELETE /patients | ✓ | ✗ | ✗ | ✗ | ✗ |
| GET /therapy-notes | ✓ | ✓ | ✓ | ✓ | ✗ |
| POST /therapy-notes | ✓ | ✓ | ✓ | ✓ | ✗ |
| DELETE /therapy-notes | ✓ | ✗ | ✗ | ✗ | ✗ |

## Error Handling

All API responses follow a consistent error format:

**Success Response:**
```json
{
  "data": { /* response data */ },
  "meta": { "message": "Success message" }
}
```

**Error Response:**
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

Common error codes:
- `UNAUTHORIZED`: No token or invalid token
- `FORBIDDEN`: Insufficient permissions
- `NOT_FOUND`: Resource not found
- `VALIDATION_ERROR`: Invalid request data
- `DUPLICATE_MRN`: Patient MRN already exists
- `LOGIN_ERROR`: Authentication failed

## Troubleshooting

### Backend Connection Issues

1. **"Cannot connect to MySQL"**
   - Check Docker container is running: `docker ps`
   - Verify MySQL is healthy: `docker logs neurolock-mysql`
   - Ensure correct port: Should be 3307 not 3306

2. **"KEK_HEX not found"**
   - Ensure .env file exists in `neurolock-staff-backend/`
   - KEK_HEX must be a valid 64-character hex string

3. **"Authentication failed"**
   - Verify JWT_SECRET matches between server and client
   - Check token is not expired
   - Ensure Bearer token format: "Bearer <token>"

### Frontend Connection Issues

1. **"Cannot reach API"**
   - Verify backend is running on port 4311
   - Check API_URL in frontend/.env is correct
   - For emulator on Windows: Use `10.0.2.2` instead of `localhost`
   - For device: Use computer's local IP (not localhost)

2. **"CORS errors"**
   - Backend has CORS middleware enabled
   - Ensure frontend is running on different port/host than backend

3. **"Token not persisting"**
   - Check AsyncStorage permission on device
   - Verify app has storage permissions

## Testing

### Manual Testing Flow

1. **Start Backend**
   ```bash
   npm run dev
   ```
   Verify: `curl http://localhost:4311/api/health`

2. **Start Frontend**
   ```bash
   npm start
   ```

3. **Login**
   - Use demo credentials: `admin@neurolock.com` / `password123`
   - Should redirect to Admin Dashboard

4. **Create Patient**
   - Navigate to Patient Records
   - Click "Add New Patient Record"
   - Fill in: MRN, Full Name, DOB, Phone, Email
   - Submit

5. **Create Therapy Note**
   - Navigate to patient profile
   - Click "Add Note"
   - Enter note content
   - Submit
   - Note should be encrypted with AES-256-GCM

6. **View Encrypted Notes**
   - Navigate back to patient profile
   - Notes should decrypt automatically
   - Verify audit logs record the access

## Development Tips

- **Hot Reload**: Both frontend and backend support hot reload during development
- **Database Queries**: Access Adminer UI at `http://localhost:8080` to inspect database
- **Network Debug**: Use React Native Debugger to inspect network requests
- **Encryption Verification**: Check encrypted data in database with Adminer

## Production Deployment

### Before Going Live

1. **Security**
   - Change JWT_SECRET to strong random value
   - Change all demo credentials
   - Implement rate limiting on login endpoint
   - Enable HTTPS only

2. **Environment**
   - Use production database (not Docker)
   - Implement database backup strategy
   - Set up error logging and monitoring
   - Configure firewall rules

3. **Performance**
   - Enable database query caching
   - Set up CDN for static assets
   - Implement API request caching
   - Set up database indexing

## References

- [AES Key Wrap (RFC 3394)](https://tools.ietf.org/html/rfc3394)
- [AES-GCM Mode](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [JWT Authentication](https://jwt.io/)
- [React Native Async Storage](https://react-native-async-storage.github.io/async-storage/)
- [Express.js Documentation](https://expressjs.com/)
- [MySQL 8.0 Reference](https://dev.mysql.com/doc/)

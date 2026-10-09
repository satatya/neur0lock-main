# NeuroLock Frontend Testing Guide

## Prerequisites ✅
- Backend API running on port 4311
- MySQL Database running on port 3307
- Frontend Expo running on port 8081
- Test account credentials ready

---

## STEP 1: Access the App

### Option A: Via Expo Go (Recommended for Mobile Testing)
1. Download **Expo Go** app from:
   - iOS App Store
   - Google Play Store
2. Open the app
3. Scan the QR code displayed in your terminal (shows when `npm start` is running)
4. App will load in ~30 seconds

### Option B: Web Browser
1. Open: http://localhost:19000
2. Press **w** in the terminal to open web view
3. App loads in browser

### Option C: Android Emulator
1. Press **a** in the terminal to open Android emulator
2. Requires Android Studio/Emulator setup

---

## STEP 2: Login Screen

1. You'll see the **NeuroLock Welcome Screen**
2. Tap **"Login"** button (blue button at bottom)
3. Fill in credentials:
   - **Email:** doctor@neurolock.com
   - **Password:** SecurePass123!
4. Tap **"Sign In"**

### Expected Result:
✅ Loading spinner appears  
✅ API connects successfully  
✅ Redirects to Psychiatrist Dashboard  

---

## STEP 3: Psychiatrist Dashboard

After successful login, you should see:

### Dashboard Components:
- **Header:** "Welcome, Dr. John Smith"
- **Navigation Tabs:**
  - 👥 Patients
  - 📋 Records
  - 📝 Notes
  - ⚙️ Settings
- **Quick Stats:**
  - Total Patients
  - Pending Notes
  - Recent Appointments

### What to Test:
1. **Tap "Patients" tab** → View patient list
2. **Tap "Records" tab** → View patient records
3. **Tap "Notes" tab** → View therapy notes (encrypted in DB)
4. **Tap "Settings" tab** → Access user settings

---

## STEP 4: Patient List Testing

1. Click **"Patients"** tab
2. You should see a list of patients (if seeded in DB)
3. **Tests to run:**
   - ✓ Scroll through list
   - ✓ Tap on a patient
   - ✓ View patient details (name, MRN, DOB, contact)
   - ✓ Go back to list

### Expected Flow:
```
Patient List → Select Patient → Patient Profile → Back to List
```

---

## STEP 5: Therapy Notes Testing

1. Click **"Notes"** tab
2. See list of therapy notes associated with patients
3. **Tests to run:**
   - ✓ View existing notes
   - ✓ Tap "Create New Note" button
   - ✓ Select a patient
   - ✓ Write a note
   - ✓ Save note
   - ✓ Verify note is encrypted in database

### To Verify Encryption:
1. Open Adminer: http://localhost:8080
2. Login: user=app, pass=NeuroLock@2025
3. Go to `therapy_notes` table
4. See columns: `dek_wrapped`, `iv`, `ciphertext` (encrypted data)
5. Note content should NOT be readable (encrypted)

---

## STEP 6: Settings & Security

1. Click **"Settings"** tab
2. **Tests to run:**
   - ✓ View profile information
   - ✓ Change password (if implemented)
   - ✓ View security settings
   - ✓ Check activity logs
   - ✓ Logout

### Logout Test:
1. Tap "Logout" button
2. Should return to Login screen
3. Session should be cleared

---

## STEP 7: API Integration Testing

### Test Backend Connectivity:

**Health Check:**
```bash
curl http://localhost:4311/api/auth/health
```
Expected: `{"status":"healthy","message":"Authentication API is operational"}`

**Test Login Endpoint:**
```bash
curl -X POST http://localhost:4311/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"doctor@neurolock.com","password":"SecurePass123!"}'
```
Expected: Returns JWT token

---

## STEP 8: Error Handling Testing

### Test Invalid Credentials:
1. Try logging in with:
   - **Wrong password:** doctor@neurolock.com / WrongPassword
   - **Non-existent email:** fake@neurolock.com / SecurePass123!
2. **Expected:** Error message displayed
3. Should NOT crash the app

### Test Network Errors:
1. Stop the backend server
2. Try to login
3. **Expected:** "Connection failed" message
4. Start backend again
5. Try login again - should work

---

## STEP 9: Role-Based Access Control

### Test Different Roles:

#### Psychiatrist (Already tested)
```
Email: doctor@neurolock.com
Pass:  SecurePass123!
```

#### Nurse Role:
```
Email: nurse@neurolock.com
Pass:  SecurePass123!
```
- Should see limited patient records
- Cannot edit medications

#### Admin Role:
```
Email: admin@neurolock.com
Pass:  SecurePass123!
```
- Should see system settings
- User management options
- System analytics

---

## STEP 10: Data Persistence Testing

1. **Create a therapy note** with content: "Test note for persistence"
2. **Go back** to dashboard
3. **Return to Notes** tab
4. **Verify:** Your note is still there (data persisted)
5. **Check Database:**
   - Open Adminer
   - Verify encrypted entry exists in `therapy_notes` table

---

## STEP 11: Performance Testing

### Measure Response Times:
1. **Login:** Should complete in <2 seconds
2. **Patient list load:** Should complete in <1 second
3. **Note creation:** Should complete in <3 seconds
4. **Navigation:** Tabs should switch instantly

### Monitor for Issues:
- No console errors
- No memory leaks
- App doesn't freeze
- Smooth animations

---

## STEP 12: UI/UX Testing

### Visual Elements:
- ✓ All buttons are clickable
- ✓ Text is readable
- ✓ Colors match design
- ✓ No overlapping elements
- ✓ Responsive on different screen sizes

### User Flow:
- ✓ Intuitive navigation
- ✓ Clear feedback (loading states)
- ✓ Error messages are helpful
- ✓ Back buttons work correctly

---

## TROUBLESHOOTING

### App Won't Load:
```bash
# Restart Expo
cd <project-folder>\frontend
npm start

# Press 'r' to reload
# Or restart from QR code scan
```

### Backend Connection Error:
```bash
# Check if backend is running
# Port 4311 should be listening
netstat -ano | findstr 4311

# Restart backend
cd <project-folder>\neurolock-staff-backend
npm run dev
```

### Database Connection Error:
```bash
# Verify MySQL is running
docker compose -f backend/sql-dbms-bundle/sql-dbms/docker-compose.yml ps

# Should show neurolock-mysql Up (healthy)
```

### Clear App Cache:
```bash
# On Expo Go app:
1. Shake device or press menu
2. Select "Clear Cache"
3. Reload app
```

---

## Test Checklist ✅

- [ ] App loads successfully
- [ ] Login with valid credentials works
- [ ] Invalid credentials show error
- [ ] Dashboard displays after login
- [ ] Patient list loads
- [ ] Can select a patient
- [ ] Can view patient details
- [ ] Can create a therapy note
- [ ] Notes are encrypted in database
- [ ] Can logout successfully
- [ ] Settings page loads
- [ ] Role-based access works
- [ ] No console errors
- [ ] App responds quickly
- [ ] Navigation is smooth

---

## Success Criteria 🎯

✅ User can login successfully  
✅ Dashboard displays with all tabs  
✅ Patient list loads and is clickable  
✅ Can create and save therapy notes  
✅ Data persists in database  
✅ Notes are properly encrypted  
✅ No errors in console  
✅ Performance is acceptable  
✅ Logout works correctly  
✅ All role-based features work  

---

## Next Steps

If all tests pass:
1. ✅ Frontend is working correctly
2. ✅ Backend API is responding
3. ✅ Database is secure (encryption verified)
4. ✅ App is ready for production

If issues found:
1. Check terminal logs
2. Check browser console (F12)
3. Verify all services are running
4. Check network requests in DevTools

---

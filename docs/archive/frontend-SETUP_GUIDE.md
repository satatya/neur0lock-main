# Complete Setup Guide for NeuroLock React Native App

## Prerequisites Installation

### 1. Install Node.js

You need to install Node.js first:

1. Go to https://nodejs.org/
2. Download the **LTS (Long Term Support)** version for Windows
3. Run the installer
4. Restart your terminal/VS Code after installation
5. Verify installation:
   ```powershell
   node --version
   npm --version
   ```

### 2. Install Git (if not already installed)

1. Go to https://git-scm.com/download/win
2. Download and install Git for Windows
3. Verify: `git --version`

## Project Setup

### Step 1: Install Dependencies

Open PowerShell or Terminal in VS Code and run:

```powershell
cd "<project-folder>"
npm install
```

If you get peer dependency warnings, try:
```powershell
npm install --legacy-peer-deps
```

### Step 2: Install Expo CLI

Install Expo CLI globally:
```powershell
npm install -g expo-cli
```

Or use npx (no global installation needed):
```powershell
npx expo --version
```

### Step 3: Install Expo Go on Your Phone

To test on a physical device:
- **iOS**: Download "Expo Go" from the App Store
- **Android**: Download "Expo Go" from the Play Store

### Step 4: Run the App

Start the development server:
```powershell
npm start
```

or

```powershell
npx expo start
```

This will:
1. Start the Metro bundler
2. Open Expo Dev Tools in your browser
3. Show a QR code

#### To Run on Phone:
- **iOS**: Open Camera app, scan QR code, tap notification
- **Android**: Open Expo Go app, tap "Scan QR Code"

#### To Run on Emulator:
- Press `a` for Android emulator (requires Android Studio)
- Press `i` for iOS simulator (Mac only, requires Xcode)
- Press `w` for web browser

## Alternative: Setting Up Emulators

### Android Emulator Setup:

1. **Install Android Studio**
   - Download from https://developer.android.com/studio
   - Install Android Studio
   - Open Android Studio → More Actions → SDK Manager
   - Install Android SDK Platform (API 33 or higher)

2. **Create Virtual Device**
   - Android Studio → More Actions → Virtual Device Manager
   - Create Device → Select a phone (e.g., Pixel 5)
   - Download and select a system image (e.g., API 33)
   - Finish and launch the emulator

3. **Run App on Android**
   ```powershell
   npx expo start
   ```
   Then press `a` or run:
   ```powershell
   npm run android
   ```

### iOS Simulator Setup (Mac Only):

1. Install Xcode from Mac App Store
2. Install Command Line Tools:
   ```bash
   xcode-select --install
   ```
3. Run:
   ```bash
   npm run ios
   ```

## Project Structure

```
neurolock/
├── App.tsx                       # Main app with React Navigation
├── index.js                      # Entry point
├── package.json                  # Dependencies
├── app.json                      # Expo configuration
├── tsconfig.json                 # TypeScript config
├── babel.config.js               # Babel config
├── metro.config.js               # Metro bundler config
│
├── components/
│   ├── WelcomeScreen.tsx         # ✅ Welcome/landing page
│   ├── LoginScreen.tsx           # ✅ Login with biometric
│   ├── MFASelectionScreen.tsx    # ✅ Choose MFA method
│   ├── OTPVerificationScreen.tsx # ✅ OTP verification
│   ├── BiometricScreen.tsx       # ✅ Biometric auth
│   └── PlaceholderScreens.tsx    # ⏳ Other screens (to implement)
│
└── assets/                       # Images, icons, fonts
```

## What's Been Converted to React Native

### ✅ Completed:
1. **Navigation**: React Navigation with Stack Navigator
2. **UI Library**: React Native Paper (Material Design)
3. **Core Screens**:
   - Welcome Screen
   - Login Screen (with biometric button)
   - MFA Selection Screen
   - OTP Verification Screen
   - Biometric Authentication Screen
4. **Authentication**: Expo Local Authentication for biometrics
5. **Styling**: React Native StyleSheet (replaced Tailwind)
6. **Components**: All using React Native components (View, Text, ScrollView, etc.)

### ⏳ Placeholder Screens (Need Implementation):
- Patient Records
- Role Selection & All Dashboards
- Patient List & Profile
- Therapy Notes
- Security Alerts
- Settings
- And 10+ more screens

## Key Differences from Web Version

| Web (Before) | React Native (Now) |
|--------------|-------------------|
| `<div>` | `<View>` |
| `<p>`, `<span>` | `<Text>` |
| `className="..."` | `style={styles.xxx}` |
| Tailwind CSS | StyleSheet.create() |
| @radix-ui components | React Native Paper |
| CSS/SCSS | StyleSheet objects |
| HTML input | TextInput component |
| onClick | onPress |
| Browser APIs | React Native/Expo APIs |

## Common Commands

```powershell
# Start development server
npm start
npx expo start

# Clear cache and restart
npx expo start --clear

# Run on specific platform
npm run android
npm run ios
npm run web

# Install a new package
npm install package-name

# Check for issues
npm install
npx expo doctor
```

## Troubleshooting

### "Module not found" errors:
```powershell
rm -rf node_modules
npm install
```

### Metro bundler issues:
```powershell
npx expo start --clear
```

### TypeScript errors:
These are expected before running `npm install`. After installation, restart VS Code.

### Biometric auth not working:
- Physical device required (or emulator with biometric capability)
- Enable biometrics in device settings
- Grant permissions when prompted

## Testing

### Recommended Testing Approach:
1. **Start Simple**: Test on physical device with Expo Go
2. **Iterative**: Add features one screen at a time
3. **Platform Specific**: Test on both iOS and Android
4. **Real Device**: Biometric features need real hardware

## Next Development Steps

1. ✅ **Install dependencies** → `npm install`
2. ✅ **Run the app** → `npm start`
3. ⏳ **Test core flow**: Welcome → Login → MFA → Role Selection
4. ⏳ **Implement dashboards** for each role
5. ⏳ **Build patient management** screens
6. ⏳ **Add secure storage** for sensitive data
7. ⏳ **Implement API integration**
8. ⏳ **Add error handling** and validation
9. ⏳ **Implement offline mode**
10. ⏳ **Add push notifications**
11. ⏳ **Security hardening** and encryption
12. ⏳ **Testing** and quality assurance

## Important Notes

- **Placeholder Implementation**: Most screens return simple placeholders. You need to implement the actual functionality.
- **No Backend**: Currently no API integration. You'll need to add your backend calls.
- **Security**: Add proper authentication, encryption, and secure storage.
- **HIPAA Compliance**: Ensure all patient data handling meets HIPAA requirements.
- **Production**: Add proper error boundaries, logging, and monitoring.

## Resources

- [React Native Docs](https://reactnative.dev/)
- [Expo Docs](https://docs.expo.dev/)
- [React Navigation](https://reactnavigation.org/)
- [React Native Paper](https://reactnativepaper.com/)
- [Expo Local Authentication](https://docs.expo.dev/versions/latest/sdk/local-authentication/)

## Support

If you encounter issues:
1. Check the error message carefully
2. Clear cache: `npx expo start --clear`
3. Reinstall: `rm -rf node_modules && npm install`
4. Check Expo documentation
5. Check React Native documentation

---

## Quick Start (After Node.js is Installed)

```powershell
# Navigate to project
cd "<project-folder>"

# Install dependencies
npm install

# Start the app
npm start

# Scan QR code with Expo Go app on your phone
```

That's it! Your React Native app should now be running. 🚀

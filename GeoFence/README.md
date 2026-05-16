# GeoFence

This is a Capacitor-safe React + Vite app. React, Leaflet, and icons are bundled locally by Vite, which avoids the black-screen `Script Error` that can happen when an iOS Capacitor WebView tries to load CDN module imports from `capacitor://localhost`.

## Run

```bash
npm install
npm run dev
```

## iOS

If you already created the iOS project from the older version, run:

```bash
npm install
npm run build
npx cap sync ios
npx cap open ios
```

If this is a fresh checkout:

```bash
npm install
npm run build
npx cap add ios
npx cap open ios
```

In Xcode, make sure `ios/App/App/Info.plist` contains:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>GeoFence uses your location to alert you when you leave a saved boundary.</string>
```

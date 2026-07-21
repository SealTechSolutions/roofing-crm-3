import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for SealTech CRM native builds (iOS + Android).
 *
 * appId — the reverse-DNS bundle identifier Apple uses to uniquely
 *   identify the app in the App Store and on-device. Must match the
 *   identifier configured in App Store Connect. Once shipped this CANNOT
 *   be changed without publishing a brand-new app.
 *
 * appName — the human-readable name shown under the icon on the home
 *   screen. Keep short so it doesn't ellipsize on iPhone SE-class screens.
 *
 * webDir — the compiled React bundle Capacitor packages into the native
 *   app. `craco build` outputs to `build/`.
 *
 * server.androidScheme — required for Android to allow the app's own web
 *   context to make HTTPS calls to the backend without cert errors.
 *
 * server.iosScheme — matches `capacitor://` so the app runs in a
 *   privileged context (no CORS issues against the CRM backend).
 *
 * server.allowNavigation — the domains the WebView is permitted to load.
 *   Currently the deployed CRM host is the only one that matters. When
 *   promoting to production, swap the preview URL for the live domain.
 */
const config: CapacitorConfig = {
  appId: 'com.sealtechbuilding.crm',
  appName: 'SealTech CRM',
  webDir: 'build',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    // Allow the app to load the deployed CRM in-place. Once we point
    // production DNS at a real sealtech domain, replace this list.
    allowNavigation: [
      'roofing-crm-3.preview.emergentagent.com',
      '*.sealtechsolutions.co',
      '*.sealtechbuilding.com',
    ],
  },
  ios: {
    // Apple Team ID — assigned to the SealTech Building Solutions Apple
    // Developer account (Individual enrollment, approved 2026-02).
    // Codemagic uses this to select the correct signing identity when
    // generating the App Store distribution certificate.
    scheme: 'App',
    // "Contentinset" tells iOS to leave the safe-area alone. `always`
    // means content stops above the home indicator and below the notch,
    // matching iOS system apps.
    contentInset: 'always',
    // Backgrounds the WebView with the SealTech navy so any brief flash
    // during app switch shows brand color instead of white.
    backgroundColor: '#062B67',
  },
  android: {
    backgroundColor: '#062B67',
    // Follow the same allowNavigation whitelist for the Android build.
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    SplashScreen: {
      // Show splash for 1.5s max — long enough for the WebView to warm up,
      // short enough that users don't feel they're staring at a loading
      // screen. Fade-out is 200ms.
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#062B67',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // Dark content on light navy — matches the CRM's blue header bars.
      // (`Dark` = dark text on light bg; `Light` = light text on dark bg.)
      // We use `Light` since the app's brand header is navy.
      style: 'LIGHT',
      backgroundColor: '#062B67',
    },
    Camera: {
      // Request permission strings shown in the native iOS permission
      // dialog when the app first asks for camera access. Apple rejects
      // apps that don't provide these strings.
      iosCameraUsageDescription:
        "SealTech CRM uses the camera to capture roof condition photos during site walks.",
      iosPhotoLibraryUsageDescription:
        "SealTech CRM saves and imports project photos from your library.",
    },
    Geolocation: {
      iosLocationUsageDescription:
        "SealTech CRM tags site photos with GPS coordinates so you can find the property later.",
    },
  },
};

export default config;

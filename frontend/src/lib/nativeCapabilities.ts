/**
 * useNativeCapabilities — small hook that surfaces whether we're running
 * inside the Capacitor-wrapped native app (iOS or Android) vs a plain web
 * browser. Used by Field Capture to swap in the native camera / GPS APIs
 * (which are more reliable on iOS than getUserMedia) whenever available.
 *
 * The Capacitor globals only exist when the app is loaded inside the
 * native shell — in a plain browser session `window.Capacitor` is
 * undefined and every helper below is a safe no-op.
 */
export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as any).Capacitor;
  return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
}

export function nativePlatform(): "ios" | "android" | "web" {
  if (typeof window === "undefined") return "web";
  const cap = (window as any).Capacitor;
  return (cap?.getPlatform?.() as any) || "web";
}

/**
 * takeNativePhoto — dynamic-import the Capacitor Camera plugin and open the
 * system camera. Returns a data URL (base64 JPEG) that the caller can
 * upload the same way it uploads a getUserMedia snapshot. Dynamic import
 * keeps the plugin out of the web bundle when we're running in a browser
 * (Capacitor plugins throw on non-native platforms).
 *
 * Rejects with an Error if the user denies the permission prompt or
 * cancels out of the native camera view.
 */
export async function takeNativePhoto(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const cameraMod = await import("@capacitor/camera");
    const { Camera, CameraResultType, CameraSource } = cameraMod;
    const image = await Camera.getPhoto({
      quality: 88,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      correctOrientation: true,
      saveToGallery: false,
    });
    return image.dataUrl || null;
  } catch (e: any) {
    // User cancel throws "User cancelled photos app" — swallow silently
    // so the field capture doesn't toast an error the user just triggered.
    const msg = (e?.message || "").toLowerCase();
    if (msg.includes("cancel") || msg.includes("denied")) return null;
    throw e;
  }
}

/**
 * getNativeGpsFix — request a single GPS fix from the native plugin.
 * Returns { lat, lon, accuracy } or null if the permission is denied or
 * we're running in a plain browser. The web fallback in FieldCapture
 * continues to use navigator.geolocation directly.
 */
export async function getNativeGpsFix(): Promise<{ lat: number; lon: number; accuracy: number } | null> {
  if (!isNative()) return null;
  try {
    const geoMod = await import("@capacitor/geolocation");
    const { Geolocation } = geoMod;
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    });
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
  } catch {
    return null;
  }
}

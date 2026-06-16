import { useRef } from "react";
import { Camera } from "lucide-react";

/**
 * CameraCaptureButton — mobile-friendly "take a photo" trigger.
 * Renders a button styled like the surrounding upload buttons. On a phone, this
 * opens the camera directly (capture="environment" hint). On desktop, browsers
 * fall back to the standard file picker. We don't hide on desktop because that
 * also means tablets/Surface devices stay supported.
 *
 * Props:
 *   onFiles(FileList)  — called when user has taken/chosen one or more photos
 *   disabled?          — locks the button (e.g., while a parent is uploading)
 *   testId?            — data-testid passthrough
 *   label?             — override the default "Take Photo"
 *   className?         — extra classes for the <label>
 */
export default function CameraCaptureButton({ onFiles, disabled, testId = "camera-capture-btn", label = "Take Photo", className = "" }) {
  const ref = useRef(null);
  return (
    <label
      className={`inline-flex items-center gap-1.5 px-3 h-9 text-[10px] font-bold uppercase tracking-wider rounded-sm cursor-pointer border border-zinc-900 text-zinc-900 hover:bg-zinc-50 ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
      data-testid={testId}
      title="Open camera (mobile) or file picker (desktop)"
    >
      <Camera className="w-3.5 h-3.5" /> {label}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files && e.target.files.length) onFiles(e.target.files);
          // reset so the same file can be selected again
          if (ref.current) ref.current.value = "";
        }}
      />
    </label>
  );
}

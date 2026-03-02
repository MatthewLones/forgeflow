/**
 * .forge file icon — a compact anvil/ingot shape with a lightning bolt,
 * representing the ForgeFlow bundled project format.
 */
export function ForgeFileIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Document shape with folded corner */}
      <path
        d="M3 1h7l3 3v11H3V1z"
        fill="currentColor"
        opacity="0.15"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M10 1v3h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      {/* Lightning bolt / forge spark */}
      <path
        d="M9 6H6.5L5.5 9.5H7.5L6.5 13L10.5 8.5H8L9 6Z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}

/** Import arrow — pointing down into tray (bringing file into the app) */
export function ForgeImportIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Arrow pointing down */}
      <path
        d="M8 3v7M8 10L5 7M8 10L11 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Tray */}
      <path
        d="M3 10v3h10v-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Export arrow — pointing up out of tray (sending file out of the app) */
export function ForgeExportIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Arrow pointing up */}
      <path
        d="M8 10V3M8 3L5 6M8 3L11 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Tray */}
      <path
        d="M3 10v3h10v-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

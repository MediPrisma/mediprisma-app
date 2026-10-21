// Next.js detects installed artifacts at build time and inlines these flags.
// Unset defaults preserve existing module consumers and tests outside Next.js.
export const CDSS_AVAILABLE = process.env.NEXT_PUBLIC_CDSS_AVAILABLE !== 'false'
export const SDK_IMPORT_AVAILABLE = process.env.NEXT_PUBLIC_SDK_IMPORT_AVAILABLE !== 'false'

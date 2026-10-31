// app/layout.tsx
import "./globals.css"
import type { Metadata } from "next"
import { Toaster } from "sonner"
import { CSP_CONTENT } from "@/src/shared/config/content-security-policy"
import { IS_STAGING_CHANNEL } from "@/src/shared/config/deploy-channel"

export const metadata: Metadata = {
  title: IS_STAGING_CHANNEL ? "測試版 · MediPrisma" : "MediPrisma · SMART on FHIR",
  description: "A FHIR-based clinical-data integration and reading tool with source-linked AI summaries, trends, and safety reminders.",
  // The staging channel is for testers only; keep it out of search results.
  ...(IS_STAGING_CHANNEL ? { robots: { index: false, follow: false } } : {}),
}


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning silences false-positive mismatches caused by
    // browser extensions (Dark Reader, 1Password, Google Translate, etc.)
    // injecting attributes / classes into <html> and <body> before React
    // hydrates. These injections look identical to a real hydration mismatch
    // in Next.js 16's stricter check. The official Next.js fix:
    // https://nextjs.org/docs/messages/react-hydration-error
    <html lang="zh-TW" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === 'production' && (
          <meta httpEquiv="Content-Security-Policy" content={CSP_CONTENT} />
        )}
        {/* Allow pinch-zoom — disabling it (maximum-scale=1, user-scalable=no)
            fails WCAG 1.4.4 and blocks low-vision users from zooming dense lab
            tables. The in-app font-size control complements, not replaces, zoom. */}
        {/* interactive-widget=resizes-content: the on-screen keyboard shrinks
            the viewport instead of overlaying it, so a `h-svh` app shell keeps
            its composer above the keyboard rather than behind it. */}
        {/* viewport-fit=cover: without it iOS reports every `env(safe-area-inset-*)`
            as 0, so the padding the workspace and the chat overlay already
            compute for the notch and the home indicator was silently inert. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
        />
      </head>
      <body suppressHydrationWarning>
        {IS_STAGING_CHANNEL && (
          <div role="status" className="fixed bottom-2 left-2 z-[9999] pointer-events-none select-none rounded bg-slate-900/85 px-2 py-0.5 text-xs font-semibold text-white shadow">
            測試版：CDSS 存檔至測試環境
          </div>
        )}
        {children}
        <Toaster richColors closeButton position="top-center" />
      </body>
    </html>
  )
}

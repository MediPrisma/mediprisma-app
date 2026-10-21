// False in the server HTML and through hydration, true from then on.
//
// For markup that depends on the reader's machine — today's date in their
// time zone, a stored preference — and so cannot be known on the server.
// Rendering it there makes hydration compare two different values; printing it
// after mount from an effect would also paint a frame of the server's guess on
// every client-side mount. With an external store React does neither: the
// hydration pass uses the server snapshot, then re-renders once, and a
// component mounted later in the browser starts at `true`.
'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => undefined
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}

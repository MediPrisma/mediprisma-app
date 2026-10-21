'use client'

import { createContext, useContext } from 'react'

/**
 * Where a carried answer came from: the saved record's day (YYYY-MM-DD), or
 * null for an answer given today. Keys are `carried-answers.store`'s:
 * `visit:<ask>`, `nyha`, `sign:<term>`, `af:<question>`, ….
 */
export type CarriedLookup = (key: string) => string | null

const NONE: CarriedLookup = () => null

export const CarriedAnswerContext = createContext<CarriedLookup>(NONE)

export function useCarriedLookup(): CarriedLookup {
  return useContext(CarriedAnswerContext)
}

/** 「帶入 · 10/07」, with the year when it is not this year's. */
export function carriedLabel(from: string, isEnglish: boolean, now: Date = new Date()): string {
  const [year, month, day] = from.split('-')
  const date = Number(year) === now.getFullYear() ? `${month}/${day}` : `${year}/${month}/${day}`
  return `${isEnglish ? 'Carried · ' : '帶入 · '}${date}`
}

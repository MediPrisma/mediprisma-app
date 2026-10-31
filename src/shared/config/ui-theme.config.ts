/**
 * UI Theme Configuration
 * Unified color system for consistent visual design across the application
 * All colors support both light and dark modes
 */

import {
  MessageSquare,
  Settings,
  Stethoscope,
  FileText,
  Files,
  Pill,
  Calendar,
  Activity,
  AlertTriangle,
  ClipboardList,
  User,
  ScrollText,
  Cpu,
  ListChecks,
  FileOutput,
  Calculator,
  LayoutDashboard,
  BookOpenCheck,
  GraduationCap,
  type LucideIcon
} from 'lucide-react'
import { PERSONALIZED_EDUCATION_FEATURE_ID } from '@/features/personalized-education/module'

// ============================================================================
// COLOR DEFINITIONS - Consistent with Prompt Gallery
// ============================================================================

export const UI_COLORS = {
  // Chat / 筆記對話 - Blue (matches Prompt Gallery Chat type)
  chat: {
    light: {
      bg: 'bg-blue-100',
      text: 'text-blue-700',
      border: 'border-border',
      activeBg: 'bg-blue-100',
      activeText: 'text-blue-700',
    },
    dark: {
      bg: 'dark:bg-blue-900/50',
      text: 'dark:text-blue-300',
      border: 'border-border',
      activeBg: 'dark:bg-blue-900/50',
      activeText: 'dark:text-blue-300',
    },
  },
  
  // Insight / 臨床洞察 - Violet (matches Prompt Gallery Insight type)
  insight: {
    light: {
      bg: 'bg-violet-100',
      text: 'text-violet-700',
      border: 'border-border',
      activeBg: 'bg-violet-100',
      activeText: 'text-violet-700',
    },
    dark: {
      bg: 'dark:bg-violet-900/50',
      text: 'dark:text-violet-300',
      border: 'border-border',
      activeBg: 'dark:bg-violet-900/50',
      activeText: 'dark:text-violet-300',
    },
  },
  
  // Clinical Data / 臨床資料 - Emerald/Green
  clinical: {
    light: {
      bg: 'bg-emerald-100',
      text: 'text-emerald-700',
      border: 'border-border',
      activeBg: 'bg-emerald-100',
      activeText: 'text-emerald-700',
    },
    dark: {
      bg: 'dark:bg-emerald-900/50',
      text: 'dark:text-emerald-300',
      border: 'border-border',
      activeBg: 'dark:bg-emerald-900/50',
      activeText: 'dark:text-emerald-300',
    },
  },
  
  // Data Selection / 資料選擇 - Amber
  selection: {
    light: {
      bg: 'bg-amber-100',
      text: 'text-amber-700',
      border: 'border-border',
      activeBg: 'bg-amber-100',
      activeText: 'text-amber-700',
    },
    dark: {
      bg: 'dark:bg-amber-900/50',
      text: 'dark:text-amber-300',
      border: 'border-border',
      activeBg: 'dark:bg-amber-900/50',
      activeText: 'dark:text-amber-300',
    },
  },
  
  // Medical Summary / 醫療摘要 - Teal (distinct from insight violet)
  summary: {
    light: {
      bg: 'bg-teal-100',
      text: 'text-teal-700',
      border: 'border-border',
      activeBg: 'bg-teal-100',
      activeText: 'text-teal-700',
    },
    dark: {
      bg: 'dark:bg-teal-900/50',
      text: 'dark:text-teal-300',
      border: 'border-border',
      activeBg: 'dark:bg-teal-900/50',
      activeText: 'dark:text-teal-300',
    },
  },

  // Settings / 設定 - Slate/Gray
  settings: {
    light: {
      bg: 'bg-slate-100',
      text: 'text-slate-700',
      border: 'border-border',
      activeBg: 'bg-slate-100',
      activeText: 'text-slate-700',
    },
    dark: {
      bg: 'dark:bg-muted/50',
      text: 'dark:text-muted-foreground',
      border: 'border-border',
      activeBg: 'dark:bg-muted/50',
      activeText: 'dark:text-muted-foreground',
    },
  },
} as const

// ============================================================================
// TAB CONFIGURATIONS - Right Panel
// ============================================================================

export interface TabThemeConfig {
  id: string
  icon: LucideIcon
  colorKey: keyof typeof UI_COLORS
}

export const RIGHT_PANEL_TAB_THEMES: Record<string, TabThemeConfig> = {
  'medical-summary': {
    id: 'medical-summary',
    icon: ClipboardList,
    colorKey: 'summary',
  },
  'medical-chat': {
    id: 'medical-chat',
    icon: MessageSquare,
    colorKey: 'chat',
  },
  'ips-export': {
    id: 'ips-export',
    icon: FileOutput,
    colorKey: 'clinical',
  },
  'medical-calculator': {
    id: 'medical-calculator',
    icon: Calculator,
    colorKey: 'clinical',
  },
  'clinical-decision-support': {
    id: 'clinical-decision-support',
    icon: BookOpenCheck,
    colorKey: 'clinical',
  },
  [PERSONALIZED_EDUCATION_FEATURE_ID]: {
    id: PERSONALIZED_EDUCATION_FEATURE_ID,
    icon: GraduationCap,
    colorKey: 'selection',
  },
  'settings': {
    id: 'settings',
    icon: Settings,
    colorKey: 'settings',
  },
}

// ============================================================================
// TAB CONFIGURATIONS - Left Panel
// ============================================================================

export const LEFT_PANEL_TAB_THEMES: Record<string, TabThemeConfig> = {
  // 總覽 uses the four-pane dashboard glyph — it is the only left tab that
  // shows several data kinds at once.
  'overview': {
    id: 'overview',
    icon: LayoutDashboard,
    colorKey: 'clinical',
  },
  'last-outpatient': {
    id: 'last-outpatient',
    icon: ClipboardList,
    colorKey: 'clinical',
  },
  'patient': {
    id: 'patient',
    icon: Stethoscope,
    colorKey: 'clinical',
  },
  'reports': {
    id: 'reports',
    icon: FileText,
    colorKey: 'clinical',
  },
  'meds': {
    id: 'meds',
    icon: Pill,
    colorKey: 'clinical',
  },
  'visits': {
    id: 'visits',
    icon: Calendar,
    colorKey: 'clinical',
  },
  // 'documents' uses `Files` (stack icon) to differentiate from 'reports'
  // (FileText, single-doc icon) at a glance even when the text wraps.
  'documents': {
    id: 'documents',
    icon: Files,
    colorKey: 'clinical',
  },
}

// ============================================================================
// FEATURE CARD CONFIGURATIONS
// ============================================================================

export const FEATURE_CARD_THEMES: Record<string, { icon: LucideIcon; colorKey: keyof typeof UI_COLORS }> = {
  'overview': { icon: LayoutDashboard, colorKey: 'clinical' },
  'last-outpatient': { icon: ClipboardList, colorKey: 'clinical' },
  'patient-info': { icon: User, colorKey: 'clinical' },
  'vitals': { icon: Activity, colorKey: 'clinical' },
  'diagnosis': { icon: ClipboardList, colorKey: 'clinical' },
  'allergies': { icon: AlertTriangle, colorKey: 'clinical' },
  'medications': { icon: Pill, colorKey: 'clinical' },
  'reports': { icon: FileText, colorKey: 'clinical' },
  'visit-history': { icon: Calendar, colorKey: 'clinical' },
  'advance-directives': { icon: ScrollText, colorKey: 'clinical' },
  'devices': { icon: Cpu, colorKey: 'clinical' },
  'care-plans': { icon: ListChecks, colorKey: 'clinical' },
  'document-summary': { icon: FileText, colorKey: 'clinical' },
}

// ============================================================================
// CENTRALIZED STYLE CLASSES
// These are static strings for Tailwind JIT to properly detect
// ============================================================================

/**
 * Tab active state classes - use these directly in TabsTrigger components
 * Light mode: colored backgrounds
 * Dark mode: subtle backgrounds with ring borders
 */
export const TAB_ACTIVE_CLASSES = {
  summary: 'data-[state=active]:bg-teal-100 data-[state=active]:text-teal-700 dark:data-[state=active]:bg-primary/10 dark:data-[state=active]:text-primary dark:data-[state=active]:ring-1 dark:data-[state=active]:ring-primary/25',
  chat: 'data-[state=active]:bg-blue-100 data-[state=active]:text-blue-700 dark:data-[state=active]:bg-primary/10 dark:data-[state=active]:text-primary dark:data-[state=active]:ring-1 dark:data-[state=active]:ring-primary/25',
  insight: 'data-[state=active]:bg-violet-100 data-[state=active]:text-violet-700 dark:data-[state=active]:bg-primary/10 dark:data-[state=active]:text-primary dark:data-[state=active]:ring-1 dark:data-[state=active]:ring-primary/25',
  selection: 'data-[state=active]:bg-amber-100 data-[state=active]:text-amber-700 dark:data-[state=active]:bg-primary/10 dark:data-[state=active]:text-primary dark:data-[state=active]:ring-1 dark:data-[state=active]:ring-primary/25',
  settings: 'data-[state=active]:bg-slate-100 data-[state=active]:text-slate-700 dark:data-[state=active]:bg-primary/10 dark:data-[state=active]:text-primary dark:data-[state=active]:ring-1 dark:data-[state=active]:ring-primary/25',
  clinical: 'data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-700 dark:data-[state=active]:bg-primary/10 dark:data-[state=active]:text-primary dark:data-[state=active]:ring-1 dark:data-[state=active]:ring-primary/25',
} as const

/**
 * Nested workspace tabs use the same flat, line-selected grammar as the
 * primary navigation. They stay touch-sized below xl and become compact on
 * pointer-oriented desktop layouts.
 */
export const SUBTAB_LIST_CLASSES =
  'h-auto min-h-[44px] rounded-none border-x-0 border-t-0 border-b border-border bg-transparent p-0 shadow-none xl:min-h-[24px]'

export const SUBTAB_TRIGGER_CLASSES =
  "relative min-h-[44px] min-w-0 rounded-none border-0 bg-transparent px-2 py-0 text-sm font-medium text-muted-foreground shadow-none transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-transparent after:content-[''] hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:after:bg-primary dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent xl:min-h-[24px]"

/**
 * Entry points that dock existing clinical content into the right pane.
 * Keep the control visibly button-like on desktop; transparent borders made
 * this existing action look absent after the shell was flattened.
 */
export const RIGHT_PANE_ACTION_CLASSES =
  'hidden cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-none transition-colors hover:border-primary/50 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 md:inline-flex'

/**
 * Card boundary classes. Routine feature cards use one neutral boundary;
 * color is reserved for states, warnings, and selected controls.
 */
export const CARD_BORDER_CLASSES = {
  summary: 'border-border',
  chat: 'border-border',
  insight: 'border-border',
  selection: 'border-border',
  settings: 'border-border',
  clinical: 'border-border',
} as const

/**
 * Badge classes for different panel types
 */
export const BADGE_CLASSES = {
  summary: 'bg-teal-200 text-teal-800 dark:bg-teal-500/20 dark:text-teal-400 border-0',
  chat: 'bg-blue-200 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400 border-0',
  insight: 'bg-violet-200 text-violet-800 dark:bg-violet-500/20 dark:text-violet-400 border-0',
  selection: 'bg-amber-200 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400 border-0',
  settings: 'bg-slate-200 text-slate-800 dark:bg-muted dark:text-muted-foreground border-0',
  clinical: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400 border-0',
} as const

// Type for panel keys
export type PanelType = keyof typeof TAB_ACTIVE_CLASSES

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get tab active classes for a panel type
 */
export function getTabClasses(panel: PanelType): string {
  return TAB_ACTIVE_CLASSES[panel]
}

/**
 * Get card border classes for a panel type
 */
export function getCardClasses(panel: PanelType): string {
  return CARD_BORDER_CLASSES[panel]
}

/**
 * Get badge classes for a panel type
 */
export function getBadgeClasses(panel: PanelType): string {
  return BADGE_CLASSES[panel]
}

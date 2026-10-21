/**
 * Composition root for the care packs.
 *
 * The registry mechanics live in `@voho0000/personalized-care/registry`, whose
 * main entry stays side-effect-free. The host — this app — is what decides
 * which packs are registered, under which source name, and which one is the
 * default, so that one call stays here: enabling a pack is an app change, not a
 * package release.
 *
 * The switcher is decided here too. The package's own getters filter on
 * `pack.enabled` and take no argument, so they can be told neither which packs
 * this host lists nor which gates it applies; rather than reach into the
 * package or register mutated copies, the host answers from its own list with
 * its own predicate. `registerCarePacks` still runs for what only it can do:
 * validate every pack against the contract.
 *
 * Two host decisions live below, and they are separate questions.
 *
 * WHICH packs: HMC lists heart failure, dyslipidemia, atrial fibrillation, and coronary disease. The preview builds
 * both from the personalization pilot branch. Local development may add
 * further branch packs through DEV_EXTRA_PACK_IDS below.
 *
 * WHETHER a listed pack shows: the Beta switch, for a pack the package ships
 * `enabled: false`. Heart failure is released; dyslipidemia remains a pilot. The 個人化照護指引 tab is itself `beta: true`,
 * so the people who reach this list are visitors who turned Beta features on
 * in Settings either way. Signing in is not part of that gate (owner decision,
 * 2026-09); the switch is stored per browser under the account uid, the
 * anonymous uid, or a guest key. Making testers ask for a URL parameter on top
 * of the switch was a second lock on the same door, so Beta alone now opens it,
 * and the per-pack pilot ids stay as the way in while Beta is off.
 */
import { PersonalizationSdkError } from '@voho0000/personalization-sdk'
import { registerCarePacks } from '@voho0000/personalized-care/registry'
import { CARE_PACKS, setLocaleLayer } from '@voho0000/personalized-care'
import { isMedcloudLaunchRoute } from '@/src/application/launch/medcloud-launch-route'
import { isVghtpeUnattendedLaunch } from '@/src/application/launch/medcloud-launch-context'
import { isBetaFeaturesEnabledInBrowser } from '@/src/application/stores/beta-features.store'
import { isPilotPack } from './pilot-gate'
import type { CdssPatientProfile, ClinicalGuidelinePack } from '../types'

/** HMC disease switcher; keep heart failure as the existing default. */
const HOST_PACK_ORDER = ['heart-failure-cdss', 'hyperlipidemia-cdss', 'atrial-fibrillation-cdss', 'chronic-coronary-disease-cdss'] as const

/**
 * Local development only: the packs a disease-branch start-of-session script
 * asks this dev server to list ahead of the host's own, so a pathway still on
 * its own mediprisma-personalization branch can be reviewed on localhost. The
 * HMC scripts set `NEXT_PUBLIC_HMC_DEV_EXTRA_PACKS` from that branch's build;
 * nothing sets it for app-hmc or /app, and a production build ignores it
 * anyway. An id the package does not ship is skipped rather than thrown on —
 * the variable names whatever the local build happens to carry. Visibility
 * still goes through `isVisible`, so an unreleased pack needs Beta like any
 * other.
 */
const DEV_EXTRA_PACK_IDS: readonly string[] = process.env.NODE_ENV === 'development'
  ? [...new Set(
      (process.env.NEXT_PUBLIC_HMC_DEV_EXTRA_PACKS ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    )]
  : []

/**
 * The default the package validates against. Heart failure carries that role
 * as the released pathway. The 個人化照護指引 tab is itself Beta-only, so the readers who
 * reach this list are still the ones the Beta switch admits; what the switcher
 * opens on is decided by `getDefaultClinicalGuidelinePack` below, which
 * follows the host order and the visibility rule instead.
 */
const HOST_DEFAULT_PACK_ID = 'heart-failure-cdss'

/**
 * The deployment's locale layer (CAD core §7.2): this host serves Taiwanese
 * hospitals, so the packs carry the Taiwan sources — NHI coverage and the
 * TSOC guidelines — beside the clinical ones. A deployment elsewhere sets
 * 'none' here and gets the clinical guidance unchanged, without a coverage
 * line. Set before any pack builds.
 */
setLocaleLayer('taiwan')

// Every pack is registered, not just the listed ones: registration is what
// validates each pack against the contract, and a pack that fails the contract
// should be caught the release it lands in, not the release it is listed in.
registerCarePacks(CARE_PACKS, {
  source: 'medical-note-smart-on-fhir/bundled-care-packs',
  defaultPackId: HOST_DEFAULT_PACK_ID,
})

const LISTED_PACKS: readonly ClinicalGuidelinePack[] = HOST_PACK_ORDER.map((id) => {
  const pack = CARE_PACKS.find((candidate) => candidate.id === id)
  if (!pack) {
    // A listed pack the package no longer carries is a wiring mistake, and a
    // silently shorter switcher is the worst way to find out about it.
    throw new PersonalizationSdkError(
      'INVALID_PACK',
      `Care pack "${id}" is listed by the host but not shipped by the package`,
      { packId: id },
    )
  }
  return pack
})

const DEV_EXTRA_PACKS: readonly ClinicalGuidelinePack[] = DEV_EXTRA_PACK_IDS
  .filter((id) => !LISTED_PACKS.some((pack) => pack.id === id))
  .flatMap((id) => CARE_PACKS.filter((candidate) => candidate.id === id))

// Branch packs lead on a dev server, so the switcher opens on the pathway
// under review once Beta shows it.
const HOST_PACKS: readonly ClinicalGuidelinePack[] = [...DEV_EXTRA_PACKS, ...LISTED_PACKS]

/** The packs this host lists, in switcher order, before the visibility gate. */
export const HOST_CARE_PACKS = HOST_PACKS

// A pack is visible when the package released it, when this browser has Beta
// features on (no sign-in required), or when it was handed to this browser as
// a single pilot id.
//
// The unattended Medcloud hand-off is outside the Beta term as well as the
// pilot one: that route shows released guidance only, whatever a tester left
// switched on in this browser earlier.
//
// Evaluated per call — nothing here is cached — so a pack appears the moment
// the Beta switch is flipped, with no reload and no module-graph reset.
function isVisible(pack: ClinicalGuidelinePack): boolean {
  if (pack.enabled) return true
  // The hospital's own hand-off (medcloud2=auto&site=vghtpe) follows the
  // Beta switch like a plain visit does; any other unattended launch shows
  // released guidance only, whatever a tester left switched on.
  if (isMedcloudLaunchRoute() && !isVghtpeUnattendedLaunch()) return false
  return isBetaFeaturesEnabledInBrowser() || isPilotPack(pack.id)
}

export function getEnabledClinicalGuidelinePacks(): readonly ClinicalGuidelinePack[] {
  return HOST_PACKS.filter(isVisible)
}

export function getClinicalGuidelinePack(id: string): ClinicalGuidelinePack | undefined {
  const pack = HOST_PACKS.find((candidate) => candidate.id === id)
  return pack && isVisible(pack) ? pack : undefined
}

export function getApplicableClinicalGuidelinePacks(
  profile: CdssPatientProfile,
): readonly ClinicalGuidelinePack[] {
  return getEnabledClinicalGuidelinePacks().filter((pack) => pack.applies(profile))
}

/**
 * What the switcher opens on when this record activates nothing: the first pack
 * the host lists that is visible. Heart failure is released, so this has an
 * answer for every browser; the throw below is what a future all-unreleased
 * list would hit rather than rendering an empty tab. The applicable-first rule
 * lives in the feature, which is the only place that has a profile to test.
 */
export function getDefaultClinicalGuidelinePack(): ClinicalGuidelinePack {
  const [first] = getEnabledClinicalGuidelinePacks()
  if (!first) {
    throw new PersonalizationSdkError(
      'DEFAULT_PACK_NOT_FOUND',
      'No care pack listed by the host is visible',
      { hostPackOrder: [...HOST_PACK_ORDER] },
    )
  }
  return first
}

import {
  createPackRegistry,
  PersonalizationSdkError,
  type PackRegistrationOptions,
} from '@voho0000/personalization-sdk'
import { BUNDLED_EDUCATION_PACKS } from './bundled'
import type { DiseaseEducationPack } from '../types'

const educationRegistry = createPackRegistry<DiseaseEducationPack>({
  packKind: 'education',
  validate(pack) {
    if (
      !pack.disease.trim()
      || typeof pack.isEligible !== 'function'
      || typeof pack.buildPlan !== 'function'
    ) {
      throw new PersonalizationSdkError(
        'INVALID_PACK',
        `Education pack "${pack.id}" does not satisfy the DiseaseEducationPack contract`,
        { packId: pack.id },
      )
    }
  },
})

export function registerEducationPacks(
  packs: readonly DiseaseEducationPack[],
  options: PackRegistrationOptions,
): void {
  educationRegistry.register(packs, options)
}

export function getEnabledDiseasePacks(): readonly DiseaseEducationPack[] {
  return educationRegistry.getAll()
}

registerEducationPacks(BUNDLED_EDUCATION_PACKS, {
  source: 'mediprisma-app/bundled-education-packs',
})

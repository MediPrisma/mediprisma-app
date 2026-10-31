// Clinical Data Collection Service
// Provides utility methods for working with ClinicalDataCollection
// Following Dependency Inversion Principle - depends on abstractions not concrete implementations

import type { ClinicalDataCollection } from '@/src/core/entities/clinical-data.entity'

/**
 * ClinicalDataCollectionService - 臨床資料集合服務
 * 
 * 提供 ClinicalDataCollection 的工具方法：
 * - 建立空集合
 * - 驗證資料
 * - 檢查是否有資料
 * 
 * 注意：這不是 Mapper，不做資料轉換
 * - FhirMapper: 將 FHIR 資源轉換為 Domain Entity
 * - Repository: 從 Server 取得資料
 * - 這個 Service: 提供 Collection 的工具方法
 */
export class ClinicalDataCollectionService {
  /**
   * Transforms raw clinical data into ClinicalDataCollection
   * Handles fallback values and data normalization
   */
  static toClinicalDataCollection(data: any): ClinicalDataCollection {
    if (!data) {
      return this.getEmptyCollection()
    }

    return {
      ...(data.clinicalSource ? { clinicalSource: data.clinicalSource } : {}),
      ...(data.sourceMetadata ? { sourceMetadata: data.sourceMetadata } : {}),
      ...(data.resourceQueryStatus ? { resourceQueryStatus: data.resourceQueryStatus } : {}),
      conditions: data.conditions || [],
      medications: data.medications || [],
      medicationRemainingSummaries: data.medicationRemainingSummaries || [],
      allergies: data.allergies || [],
      diagnosticReports: data.diagnosticReports || [],
      imagingStudies: data.imagingStudies || [],
      observations: data.observations || data.vitalSigns || data.vitals || [],
      vitalSigns: data.vitalSigns || data.vitals || [],
      procedures: data.procedures || [],
      encounters: data.encounters || [],
      documentReferences: data.documentReferences || [],
      compositions: data.compositions || [],
      immunizations: data.immunizations || [],
      consents: data.consents || [],
      devices: data.devices || [],
      carePlans: data.carePlans || []
    }
  }

  /**
   * Returns an empty ClinicalDataCollection
   * Useful for initialization and error states
   */
  static getEmptyCollection(): ClinicalDataCollection {
    return {
      conditions: [],
      medications: [],
      medicationRemainingSummaries: [],
      allergies: [],
      diagnosticReports: [],
      imagingStudies: [],
      observations: [],
      vitalSigns: [],
      procedures: [],
      encounters: [],
      documentReferences: [],
      compositions: [],
      immunizations: [],
      consents: [],
      devices: [],
      carePlans: []
    }
  }

  /**
   * Validates if clinical data has required fields
   */
  static isValid(data: any): boolean {
    return data !== null && data !== undefined && typeof data === 'object'
  }

  /**
   * Checks if clinical data collection has any data
   */
  static hasData(collection: ClinicalDataCollection): boolean {
    return (
      collection.conditions.length > 0 ||
      collection.medications.length > 0 ||
      collection.medicationRemainingSummaries.length > 0 ||
      collection.allergies.length > 0 ||
      collection.diagnosticReports.length > 0 ||
      collection.imagingStudies.length > 0 ||
      collection.observations.length > 0 ||
      collection.vitalSigns.length > 0 ||
      collection.procedures.length > 0 ||
      collection.encounters.length > 0 ||
      collection.documentReferences.length > 0 ||
      collection.compositions.length > 0
    )
  }
}

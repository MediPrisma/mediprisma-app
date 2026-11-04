export interface PatientInfo {
  name: string
  gender: string
  age: string
  id?: string
  // Extended demographics — surfaced behind a "更多資料" toggle in
  // PatientInfoDisplay. Empty array = nothing to show.
  identifiers?: Array<{ label: string; value: string; primary?: boolean }>
  birthDate?: string
  telecom?: Array<{ label: string; value: string }>
  addresses?: string[]
  maritalStatus?: string
  languages?: string[]
  contacts?: Array<{ relationship: string; name: string; phone?: string }>
  userEnteredFields?: Array<'name' | 'gender' | 'birthDate'>
}

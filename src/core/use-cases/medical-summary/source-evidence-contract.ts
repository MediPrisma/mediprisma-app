/** Shared by summary and safety: preserve the relationship between a test,
 * its result and its own source key, regardless of the kind of panel. */
export const LAB_SOURCE_EVIDENCE_RULE =
  'For a multi-test panel, keep each test name, result and unit together exactly as listed on its individual Observation line. ' +
  'Cite the individual Observation key beside that test-value pair rather than the panel container. ' +
  'Never transfer a neighbouring test\'s result to another name. '

export const CLINICAL_ATTRIBUTION_RULE = 'A valid source key alone does not establish a diagnosis: verify that the cited test or medication mechanism supports the problem name. If the indication is unknown, describe the finding or medication use without inventing a disease. '

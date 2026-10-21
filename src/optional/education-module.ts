// Keep the existing patient tab reachable; missing content is explicit there.
export const PERSONALIZED_EDUCATION_FEATURE_ID = 'personalized-education'
export const PERSONALIZED_EDUCATION_MODULE = {
  id: PERSONALIZED_EDUCATION_FEATURE_ID,
  name: 'Personalized Education',
  rightPanel: {
    id: PERSONALIZED_EDUCATION_FEATURE_ID,
    name: 'Personalized Education',
    tabLabel: 'personalizedEducation',
    badge: 'Beta',
    beta: true,
    order: 5,
    enabled: true,
    pinned: true,
    forceMount: true,
    audiences: ['patient'],
    scrollMode: 'panel',
  },
} as const

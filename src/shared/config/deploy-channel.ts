/** Build-time release channel: `staging` for mediprisma.tw/app-staging, production otherwise. */
export const IS_STAGING_CHANNEL = process.env.NEXT_PUBLIC_DEPLOY_CHANNEL === 'staging'

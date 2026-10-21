import type { BrowserContext, Page } from '@playwright/test'

/** Synthetic SDK login only; all identity calls stay intercepted locally. */
export async function stubCdssAccount(context: BrowserContext) {
  const uid = 'e2e-cdss-owner'
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const token = [encode({ alg: 'none', typ: 'JWT' }), encode({ iss: 'https://securetoken.google.com/e2e-mediprisma',
    aud: 'e2e-mediprisma', sub: uid, user_id: uid, auth_time: now, iat: now, exp: now + 3600,
    firebase: { identities: { email: ['cdss@synthetic.invalid'] }, sign_in_provider: 'password' } }), 'synthetic-signature'].join('.')
  await context.route('**/identitytoolkit.googleapis.com/**', async route => {
    const url = route.request().url()
    if (url.includes('accounts:signInWithPassword')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      localId: uid, email: 'cdss@synthetic.invalid', displayName: 'Synthetic CDSS', idToken: token,
      refreshToken: 'synthetic-refresh', expiresIn: '3600', registered: true,
    }) })
    if (url.includes('accounts:lookup') && route.request().postDataJSON()?.idToken === token)
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ users: [{ localId: uid,
        email: 'cdss@synthetic.invalid', emailVerified: true, displayName: 'Synthetic CDSS',
        providerUserInfo: [{ providerId: 'password', email: 'cdss@synthetic.invalid' }], validSince: '0' }] }) })
    await route.fallback()
  })
  return token
}

export async function signInCdssAccount(page: Page) {
  // Imported-bundle notices overlap the mobile account menu; dismiss them through their real control.
  const notices = page.getByRole('button', { name: 'Close toast', exact: true })
  for (let count = 0; count < 8 && await notices.count(); count++) await notices.first().click()
  await page.getByRole('button', { name: '訪客', exact: true }).click()
  await page.getByRole('menuitem', { name: '登入解鎖更多免費額度' }).click()
  const login = page.getByRole('dialog', { name: '登入', exact: true })
  await login.locator('#email').fill('cdss@synthetic.invalid')
  await login.locator('#password').fill('synthetic-test-password')
  await login.getByRole('button', { name: '登入', exact: true }).click()
  await login.waitFor({ state: 'hidden' })
}

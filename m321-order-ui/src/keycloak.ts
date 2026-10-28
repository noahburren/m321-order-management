import Keycloak from 'keycloak-js'

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080',
  realm: 'm321',
  clientId: 'm321-order-client',
})

export async function validAccessToken(): Promise<string> {
  if (!keycloak.authenticated) {
    throw new Error('Nicht angemeldet')
  }
  await keycloak.updateToken(30)
  if (!keycloak.token) {
    throw new Error('Kein Zugriffstoken verfügbar')
  }
  return keycloak.token
}

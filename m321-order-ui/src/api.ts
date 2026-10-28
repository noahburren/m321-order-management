import { validAccessToken } from './keycloak'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8081'

export type AcceptedOrder = {
  orderId: string
  correlationId: string
  status: 'ACCEPTED'
  acceptedAt: string
}

export type ApiVersion = 'v1' | 'v2'

export type OrderStatus = {
  orderId: string
  status: 'ACCEPTED' | 'PROCESSED'
  acceptedAt: string
  processedAt: string | null
}

export type SystemStatus = {
  orderService: 'ONLINE'
  queue: {
    available: boolean
    ready: number | null
    unacked: number | null
    consumers: number | null
  }
  observedAt: string
}

async function authenticatedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await validAccessToken()
  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  })
}

export async function createOrder(
  product: string,
  quantity: number,
  version: ApiVersion,
): Promise<AcceptedOrder> {
  const response = await authenticatedFetch(`/api/${version}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Correlation-ID': crypto.randomUUID() },
    body: JSON.stringify(version === 'v1'
      ? { product, quantity }
      : { productCode: product, amount: quantity }),
  })
  if (response.status !== 202) {
    throw new Error(`Bestellung konnte nicht angenommen werden (HTTP ${response.status})`)
  }
  return response.json() as Promise<AcceptedOrder>
}

export async function fetchOrderStatus(orderId: string): Promise<OrderStatus | null> {
  const response = await authenticatedFetch(`/api/v1/orders/${orderId}/status`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Order-Status nicht verfügbar (HTTP ${response.status})`)
  return response.json() as Promise<OrderStatus>
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const response = await authenticatedFetch('/api/v1/system/status')
  if (!response.ok) throw new Error(`Systemstatus nicht verfügbar (HTTP ${response.status})`)
  return response.json() as Promise<SystemStatus>
}

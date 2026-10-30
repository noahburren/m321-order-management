import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createOrder, fetchOrderStatus, fetchSystemStatus } from './api'
import type { AcceptedOrder, ApiVersion, SystemStatus } from './api'
import { keycloak } from './keycloak'

type SessionOrder = Omit<AcceptedOrder, 'status'> & {
  status: 'ACCEPTED' | 'PROCESSED'
  product: string
  quantity: number
  processedAt?: string | null
  apiVersion: ApiVersion
}

type JourneyStop = {
  title: string
  owner: string
  detail: string
  technical: string
  kind: 'person' | 'service' | 'database' | 'broker'
}

const STORAGE_KEY = 'm321-session-orders'
const DEMO_STEP_MS = 850

const JOURNEY: JourneyStop[] = [
  { title: 'Benutzer', owner: 'Keycloak', detail: 'Anmeldung bestätigt', technical: 'OIDC · Authorization Code + PKCE', kind: 'person' },
  { title: 'Web-App', owner: 'React UI', detail: 'Bestellung abgesendet', technical: 'JWT · Correlation-ID · REST v1/v2', kind: 'service' },
  { title: 'Order API', owner: 'Order Service', detail: 'Request validiert', technical: 'Rolle USER · HTTP 202 Accepted', kind: 'service' },
  { title: 'Order-DB', owner: 'PostgreSQL', detail: 'Order + Outbox gespeichert', technical: 'Schema order_service · 1 Transaktion', kind: 'database' },
  { title: 'Hinweg', owner: 'RabbitMQ', detail: 'OrderCreated wartet/fährt', technical: 'orders.processing · persistent', kind: 'broker' },
  { title: 'Verarbeitung', owner: 'Processing Service', detail: 'Worker verarbeitet Auftrag', technical: 'Competing Consumer · Retry', kind: 'service' },
  { title: 'Processing-DB', owner: 'PostgreSQL', detail: 'Inbox + Outbox gespeichert', technical: 'Schema processing_service · idempotent', kind: 'database' },
  { title: 'Rückweg', owner: 'RabbitMQ', detail: 'OrderProcessed zugestellt', technical: 'order.processed.v1 · persistent', kind: 'broker' },
  { title: 'Ziel', owner: 'Order Service', detail: 'Status PROCESSED', technical: 'Order-DB aktualisiert · UI informiert', kind: 'service' },
]

function readOrders(): SessionOrder[] {
  try {
    return (JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]') as SessionOrder[])
      .map((order) => ({ ...order, apiVersion: order.apiVersion ?? 'v1' }))
  } catch { return [] }
}

const shortId = (id: string) => `#${id.slice(0, 8).toUpperCase()}`
const time = (value: string) => new Intl.DateTimeFormat('de-CH', {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(new Date(value))

function App() {
  const [authReady, setAuthReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [product, setProduct] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [apiVersion, setApiVersion] = useState<ApiVersion>('v1')
  const [orders, setOrders] = useState<SessionOrder[]>(readOrders)
  const [selectedOrderId, setSelectedOrderId] = useState<string>()
  const [replayStartedAt, setReplayStartedAt] = useState<Record<string, number>>({})
  const [system, setSystem] = useState<SystemStatus>()
  const [reachable, setReachable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(Date.now())

  useEffect(() => {
    keycloak.init({ onLoad: 'check-sso', pkceMethod: 'S256', checkLoginIframe: false })
      .then((loggedIn) => setAuthenticated(loggedIn))
      .catch(() => setError('Die Anmeldung konnte nicht initialisiert werden.'))
      .finally(() => setAuthReady(true))
  }, [])

  useEffect(() => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(orders)), [orders])
  useEffect(() => {
    if (!selectedOrderId && orders.length) setSelectedOrderId(orders[0].orderId)
  }, [orders, selectedOrderId])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 300)
    return () => window.clearInterval(timer)
  }, [])

  const refresh = useCallback(async () => {
    if (!authenticated) return
    try { setSystem(await fetchSystemStatus()); setReachable(true) }
    catch { setReachable(false) }

    const pending = orders.filter((order) => order.status !== 'PROCESSED')
    const results = await Promise.allSettled(pending.map(async (order) => ({
      orderId: order.orderId, state: await fetchOrderStatus(order.orderId),
    })))
    const processed = new Map(results.flatMap((result) =>
      result.status === 'fulfilled' && result.value.state?.status === 'PROCESSED'
        ? [[result.value.orderId, result.value.state]] : [],
    ))
    if (processed.size) setOrders((current) => current.map((order) => {
      const state = processed.get(order.orderId)
      return state ? { ...order, status: 'PROCESSED', processedAt: state.processedAt } : order
    }))
  }, [authenticated, orders])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!product.trim() || quantity < 1) return
    setSubmitting(true); setError('')
    try {
      const accepted = await createOrder(product.trim(), quantity, apiVersion)
      const order = { ...accepted, product: product.trim(), quantity, apiVersion }
      setOrders((current) => [order, ...current])
      setSelectedOrderId(order.orderId)
      setReplayStartedAt((current) => ({ ...current, [order.orderId]: Date.now() }))
      setProduct(''); setQuantity(1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Bestellung konnte nicht erfasst werden.')
    } finally { setSubmitting(false) }
  }

  const selectedOrder = orders.find((order) => order.orderId === selectedOrderId)
  const token = keycloak.tokenParsed
  const userName = token?.name || token?.preferred_username || 'Demo User'
  const roles = token?.realm_access?.roles?.filter((role) => role === 'USER' || role === 'ADMIN') ?? []
  const ready = system?.queue.available ? system.queue.ready : null
  const unacked = system?.queue.available ? system.queue.unacked : null
  const consumers = system?.queue.available ? system.queue.consumers : null

  const journeyStage = useMemo(() => {
    if (!selectedOrder) return -1
    const start = replayStartedAt[selectedOrder.orderId]
      ?? (selectedOrder.status === 'PROCESSED' ? 0 : Date.parse(selectedOrder.acceptedAt))
    if (start === 0) return JOURNEY.length - 1
    const timedStage = Math.floor(Math.max(0, clock - start) / DEMO_STEP_MS)
    const realityLimit = selectedOrder.status === 'PROCESSED'
      ? JOURNEY.length - 1
      : (consumers ?? 0) > 0 ? 6 : 4
    return Math.min(timedStage, realityLimit)
  }, [clock, consumers, replayStartedAt, selectedOrder])

  const replay = () => {
    if (!selectedOrder) return
    setReplayStartedAt((current) => ({ ...current, [selectedOrder.orderId]: Date.now() }))
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">M</div><div><h1>M321 Transit Control</h1><p>Distributed Order Management</p></div></div>
      <div className="top-status"><span className={reachable ? 'live' : ''}><i />{reachable ? 'System live' : 'Offline'}</span>
        {authenticated ? <><div className="account-copy"><strong>{userName}</strong><small>{roles.join(' · ') || 'Angemeldet'}</small></div>
          <button className="button ghost" onClick={() => void keycloak.logout({ redirectUri: location.origin })}>Logout</button></>
          : <button className="button primary" disabled={!authReady} onClick={() => void keycloak.login()}>Mit Keycloak anmelden</button>}</div>
    </header>

    <main>
      <section className="hero">
        <div><span className="eyebrow">Demo-Leitstand</span><h2>Jede Bestellung. Jede Station. Ein Bildschirm.</h2>
          <p>Der technische Weg vom Benutzer bis zur bestätigten Verarbeitung – live wie auf einem ÖV-Fahrplan.</p></div>
        <div className="hero-clock"><small>Systemzeit</small><strong>{new Date(clock).toLocaleTimeString('de-CH')}</strong>
          <span>Aktualisierung jede Sekunde</span></div>
      </section>

      {error && <div className="alert error">{error}</div>}

      <section className="control-grid">
        <article className="panel order-form"><PanelTitle kicker="Neue Fahrt" title="Bestellung aufgeben" />
          <form onSubmit={(event) => void submit(event)}>
            <label>Produkt<input value={product} onChange={(event) => setProduct(event.target.value)}
              placeholder="z. B. Keyboard" required disabled={!authenticated} /></label>
            <div className="form-row"><label>API<select value={apiVersion}
              onChange={(event) => setApiVersion(event.target.value as ApiVersion)} disabled={!authenticated}>
              <option value="v1">REST v1</option><option value="v2">REST v2</option></select></label>
              <label>Menge<div className="quantity"><button type="button" disabled={!authenticated || quantity <= 1}
                onClick={() => setQuantity((n) => Math.max(1, n - 1))}>−</button><input type="number" min="1" value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} disabled={!authenticated} />
                <button type="button" disabled={!authenticated} onClick={() => setQuantity((n) => n + 1)}>+</button></div></label></div>
            <button className="button primary submit" disabled={!authenticated || submitting}>
              {submitting ? 'Ticket wird erstellt …' : 'Bestellung starten'}</button>
            {!authenticated && <p className="hint">Zuerst über Keycloak anmelden.</p>}
          </form></article>

        <article className="panel orders-panel"><PanelTitle kicker="Fahrten" title="Bestellungen dieser Sitzung" count={orders.length} />
          {!orders.length ? <div className="empty"><span>↔</span><strong>Noch keine Fahrt</strong><p>Erstelle eine Bestellung, um den Live-Fahrplan zu starten.</p></div>
            : <div className="order-list">{orders.map((order) => <button type="button"
              className={`order-row ${selectedOrderId === order.orderId ? 'selected' : ''}`}
              onClick={() => setSelectedOrderId(order.orderId)} key={order.orderId}>
              <span className="line-badge">{order.apiVersion.toUpperCase()}</span><div><strong>{order.product} × {order.quantity}</strong>
                <small>{shortId(order.orderId)} · {time(order.acceptedAt)}</small></div>
              <span className={`order-state ${order.status.toLowerCase()}`}><i />{order.status === 'PROCESSED' ? 'Am Ziel' : 'Unterwegs'}</span>
            </button>)}</div>}
        </article>
      </section>

      <section className="panel journey-panel">
        <div className="journey-heading"><div><span className="eyebrow">Linie O–P–O</span><h2>Technischer Fahrplan</h2>
          <p>{selectedOrder ? <><strong>{selectedOrder.product}</strong> · {shortId(selectedOrder.orderId)} · Correlation {selectedOrder.correlationId}</>
            : 'Wähle oder erstelle eine Bestellung.'}</p></div>
          <div className="journey-actions"><div className="legend"><span className="done">Erledigt</span><span className="active">Aktuell</span><span>Geplant</span></div>
            <button className="button secondary" disabled={!selectedOrder} onClick={replay}>↻ Fahrt langsam abspielen</button></div></div>

        <div className="route-wrap"><div className="route-line" />
          <div className="route">{JOURNEY.map((stop, index) => {
            const finalDone = selectedOrder?.status === 'PROCESSED' && index === JOURNEY.length - 1 && journeyStage === index
            const state = index < journeyStage || finalDone ? 'done' : index === journeyStage ? 'active' : 'planned'
            const extra = stop.kind === 'broker' && index === 4
              ? `Ready ${ready ?? '–'} · Unacked ${unacked ?? '–'}`
              : index === 5 ? `${consumers ?? '–'} Worker aktiv` : stop.technical
            return <article className={`stop ${state}`} key={`${stop.title}-${index}`}>
              <div className={`stop-marker ${stop.kind}`}><span>{index + 1}</span></div>
              <div className="stop-time">+{(index * DEMO_STEP_MS / 1000).toFixed(1)}s</div>
              <h3>{stop.title}</h3><strong>{stop.owner}</strong><p>{stop.detail}</p><small>{extra}</small>
            </article>
          })}</div></div>

        <div className="journey-footer">
          <div><span>Aktueller Halt</span><strong>{journeyStage >= 0 ? `${journeyStage + 1}/${JOURNEY.length} · ${JOURNEY[journeyStage].title}` : 'Keine Bestellung gewählt'}</strong></div>
          <div><span>Fachstatus</span><strong>{selectedOrder?.status ?? '–'}</strong></div>
          <div><span>Verarbeitet um</span><strong>{selectedOrder?.processedAt ? time(selectedOrder.processedAt) : 'noch unterwegs'}</strong></div>
        </div>
      </section>

      <section className="infrastructure">
        <div className="section-title"><div><span className="eyebrow">Alles an einem Ort</span><h2>System & Infrastruktur</h2></div>
          {system && <small>Live-Daten von {time(system.observedAt)}</small>}</div>
        <div className="infra-grid">
          <InfraCard number="A" title="Identity & User" status={authenticated ? 'Angemeldet' : 'Login nötig'} online={authenticated}
            rows={[["Provider", "Keycloak"], ["Benutzer", userName], ["Rollen", roles.join(', ') || '–'], ["Flow", "OIDC + PKCE"]]} />
          <InfraCard number="B" title="Order Service" status={reachable ? 'Online' : 'Offline'} online={reachable}
            rows={[["API", "REST v1 + v2"], ["Datenbank", "PostgreSQL"], ["Schema/User", "order_service"], ["Zuverlässigkeit", "Transactional Outbox"]]} />
          <InfraCard number="C" title="Message Broker" status={system?.queue.available ? 'Online' : 'Unbekannt'} online={!!system?.queue.available}
            rows={[["Broker", "RabbitMQ"], ["Queue", "orders.processing"], ["Ready / Unacked", `${ready ?? '–'} / ${unacked ?? '–'}`], ["Zustellung", "at-least-once"]]} />
          <InfraCard number="D" title="Processing Service" status={(consumers ?? 0) > 0 ? 'Aktiv' : 'Keine Worker'} online={(consumers ?? 0) > 0}
            rows={[["Worker", `${consumers ?? '–'} Consumer`], ["Datenbank", "PostgreSQL"], ["Schema/User", "processing_service"], ["Sicherheit", "Inbox + Outbox"]]} />
        </div>
      </section>
    </main>
  </div>
}

function PanelTitle({ kicker, title, count }: { kicker: string; title: string; count?: number }) {
  return <div className="panel-title"><div><span className="eyebrow">{kicker}</span><h3>{title}</h3></div>
    {count !== undefined && <span className="count">{count}</span>}</div>
}

function InfraCard({ number, title, status, online, rows }: {
  number: string; title: string; status: string; online: boolean; rows: string[][]
}) {
  return <article className="infra-card"><div className="infra-head"><span>{number}</span><div><h3>{title}</h3>
    <small className={online ? 'online' : ''}><i />{status}</small></div></div>
    <dl>{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></article>
}

export default App

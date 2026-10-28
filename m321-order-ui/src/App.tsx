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
const STORAGE_KEY = 'm321-session-orders'

function readOrders(): SessionOrder[] {
  try {
    return (JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]') as SessionOrder[])
      .map((order) => ({ ...order, apiVersion: order.apiVersion ?? 'v1' }))
  }
  catch { return [] }
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
  const [system, setSystem] = useState<SystemStatus>()
  const [reachable, setReachable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<SessionOrder>()
  const [error, setError] = useState('')

  useEffect(() => {
    keycloak.init({ onLoad: 'check-sso', pkceMethod: 'S256', checkLoginIframe: false })
      .then(async (loggedIn) => {
        setAuthenticated(loggedIn)
      })
      .catch(() => setError('Die Anmeldung konnte nicht initialisiert werden.'))
      .finally(() => setAuthReady(true))
  }, [])

  useEffect(() => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(orders)), [orders])

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
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!product.trim() || quantity < 1) return
    setSubmitting(true); setError('')
    try {
      const accepted = await createOrder(product.trim(), quantity, apiVersion)
      const order = { ...accepted, product: product.trim(), quantity, apiVersion }
      setOrders((current) => [order, ...current]); setNotice(order); setProduct(''); setQuantity(1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Bestellung konnte nicht erfasst werden.')
    } finally { setSubmitting(false) }
  }

  const token = keycloak.tokenParsed
  const userName = token?.name || token?.preferred_username
  const ready = system?.queue.available ? system.queue.ready : null
  const unacked = system?.queue.available ? system.queue.unacked : null
  const consumers = system?.queue.available ? system.queue.consumers : null
  const queueHeadline = useMemo(() => {
    if (!system?.queue.available) return 'Status derzeit nicht verfügbar'
    if ((ready ?? 0) > 1) return `${ready} Bestellungen warten`
    if (ready === 1) return '1 Bestellung wartet'
    if ((unacked ?? 0) > 0) return `${unacked} in Verarbeitung`
    return 'Keine Bestellungen warten'
  }, [ready, system, unacked])

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">M</div><div><h1>M321 Order Management</h1><p>Order Processing</p></div></div>
      <div className="account">{authenticated ? <>
        <div className="account-copy"><span>{userName}</span><small>Angemeldet</small></div>
        <button className="button button-secondary" onClick={() => void keycloak.logout({ redirectUri: location.origin })}>Logout</button>
      </> : <button className="button button-primary" disabled={!authReady} onClick={() => void keycloak.login()}>Login</button>}</div>
    </header>

    <main>
      <section className="intro"><div><span className="eyebrow">Auftragsübersicht</span>
        <h2>Bestellungen zuverlässig erfassen und verarbeiten.</h2>
        <p>Neue Aufträge werden direkt angenommen und im Hintergrund verarbeitet.</p></div>
        <div className={`availability ${reachable ? 'is-online' : ''}`}><i className="dot" />
          {reachable ? 'System bereit' : authenticated ? 'Verbindung wird geprüft' : 'Login erforderlich'}</div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success"><div><strong>Bestellung angenommen</strong>
        <span>{shortId(notice.orderId)} · {notice.product} × {notice.quantity}</span></div>
        <dl><div><dt>Order ID</dt><dd>{notice.orderId}</dd></div><div><dt>Correlation ID</dt><dd>{notice.correlationId}</dd></div></dl>
        <button aria-label="Hinweis schließen" onClick={() => setNotice(undefined)}>×</button></div>}

      <section className="business-grid">
        <article className="card form-card"><Heading eyebrow="Erfassung" title="Neue Bestellung" />
          <form onSubmit={(event) => void submit(event)}><label>Produkt<input value={product}
            onChange={(event) => setProduct(event.target.value)} placeholder="z. B. Keyboard" required disabled={!authenticated} /></label>
            <label>API-Version<select value={apiVersion}
              onChange={(event) => setApiVersion(event.target.value as ApiVersion)} disabled={!authenticated}>
              <option value="v1">v1 – product / quantity</option>
              <option value="v2">v2 – productCode / amount</option>
            </select></label>
            <label>Menge<div className="quantity"><button type="button" disabled={!authenticated || quantity <= 1}
              onClick={() => setQuantity((n) => Math.max(1, n - 1))}>−</button><input type="number" min="1" value={quantity}
              onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} disabled={!authenticated} />
              <button type="button" disabled={!authenticated} onClick={() => setQuantity((n) => n + 1)}>+</button></div></label>
            <button className="button button-primary submit" disabled={!authenticated || submitting}>
              {submitting ? 'Wird erfasst …' : 'Bestellung erfassen'}</button>
            {!authenticated && <p className="hint">Melde dich an, um eine Bestellung zu erfassen.</p>}
          </form></article>

        <article className="card orders-card"><Heading eyebrow="Diese Sitzung" title="Bestellungen" count={orders.length} />
          {!orders.length ? <div className="empty"><div>□</div><strong>Noch keine Bestellungen</strong>
            <p>Neu erfasste Bestellungen erscheinen hier für diese Browser-Sitzung.</p></div>
          : <div className="order-list">{orders.map((order) => <div className="order-row" key={order.orderId}>
            <div className="order-main"><span>{shortId(order.orderId)}</span><strong>{order.product}</strong>
              <small>{order.quantity} Stück · API {order.apiVersion} · {time(order.acceptedAt)}</small>
              <small title={order.correlationId}>Correlation: {order.correlationId}</small></div>
            <div className={`order-status ${order.status.toLowerCase()}`}><i className="dot" />
              {order.status === 'PROCESSED' ? 'Verarbeitet' : 'Angenommen'}</div></div>)}</div>}
        </article>
      </section>

      <section className="processing-section">
        <div className="section-heading"><div><span className="eyebrow">Live-Status</span><h2>Auftragsverarbeitung</h2>
          <p>Der aktuelle Weg einer Bestellung durch das verteilte System.</p></div>
          {system && <small>Aktualisiert {time(system.observedAt)}</small>}</div>
        <div className="flow">
          <FlowCard icon="01" title="Order Service" state={reachable ? 'Online' : 'Nicht erreichbar'} active={reachable}
            text="Nimmt Bestellungen an und übergibt sie zuverlässig zur Verarbeitung." technical="Order Service" />
          <Arrow label="OrderCreated" />
          <article className="flow-card queue-card"><div className="flow-icon queue-icon">↕</div><h3>Auftragswarteschlange</h3>
            <strong className="queue-headline">{queueHeadline}</strong><small>RabbitMQ / orders.processing</small>
            <dl className="metrics"><Metric name="Ready" value={ready} /><Metric name="Unacked" value={unacked} />
              <Metric name="Consumers" value={consumers} /></dl></article>
          <Arrow label="Verteilung" />
          <article className="flow-card"><div className="flow-icon processing-icon">✓</div>
            <div className="flow-title"><h3>Verarbeitung</h3><Status active={(consumers ?? 0) > 0}
              text={consumers == null ? 'Unbekannt' : consumers > 0 ? 'Aktiv' : 'Keine Worker'} /></div>
            {consumers != null && consumers > 0 ? <div className="workers">{Array.from({ length: consumers }, (_, i) =>
              <span key={i}>Worker {i + 1}<i /></span>)}</div> : <p>Bestellungen bleiben sicher in der Warteschlange, bis ein Worker verfügbar ist.</p>}
            <small>Processing Service · {consumers ?? '–'} Worker</small></article>
        </div>
        <div className="return-flow"><span>Nach erfolgreicher Verarbeitung</span><i /><strong>OrderProcessed</strong>
          <span>wird an den Order Service zurückgemeldet</span></div>
      </section>
    </main>
  </div>
}

function Heading({ eyebrow, title, count }: { eyebrow: string; title: string; count?: number }) {
  return <div className="card-heading"><div><span className="eyebrow">{eyebrow}</span><h3>{title}</h3></div>
    {!!count && <span className="count">{count}</span>}</div>
}
function Status({ active, text }: { active: boolean; text: string }) {
  return <span className={`status-pill ${active ? 'online' : ''}`}><i />{text}</span>
}
function FlowCard(props: { icon: string; title: string; state: string; active: boolean; text: string; technical: string }) {
  return <article className="flow-card"><div className="flow-icon service-icon">{props.icon}</div>
    <div className="flow-title"><h3>{props.title}</h3><Status active={props.active} text={props.state} /></div>
    <p>{props.text}</p><small>{props.technical}</small></article>
}
function Arrow({ label }: { label: string }) { return <div className="flow-arrow"><span>→</span><small>{label}</small></div> }
function Metric({ name, value }: { name: string; value: number | null | undefined }) {
  return <div><dt>{name}</dt><dd>{value ?? '–'}</dd></div>
}

export default App

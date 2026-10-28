# M321 Order Management UI

Single-page React application for the existing M321 order-processing flow.

## Local development

```powershell
npm install
npm run dev
```

The UI expects Keycloak at `http://localhost:8080` and the Order Service at
`http://localhost:8081`. Override these with `VITE_KEYCLOAK_URL` and `VITE_API_URL`.

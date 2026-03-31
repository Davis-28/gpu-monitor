const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const get  = async path => { const r = await fetch(`${BASE}${path}`); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }
const post = async (path,body) => { const r = await fetch(`${BASE}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }
const qs   = p => new URLSearchParams(p).toString()
export const api = {
  health:        ()    => get('/health'),
  metrics:       p     => get(`/metrics?${qs(p)}`),
  insights:      (p={})=> get(`/insights?${qs(p)}`),
  costs:         (p={})=> get(`/costs?${qs(p)}`),
  costHistory:   (p={})=> get(`/costs/history?${qs(p)}`),
  projection:    (p={})=> get(`/projection?${qs(p)}`),
  processes:     (p={})=> get(`/processes?${qs(p)}`),
  machines:      ()    => get('/machines'),
  settings:      ()    => get('/settings'),
  saveSetting:   (k,v) => post('/settings',{key:k,value:v}),
  autoRules:     ()    => get('/automation/rules'),
  setAutoRule:   (code,enabled) => post('/automation/rules',{rule_code:code,enabled}),
  autoLog:       ()    => get('/automation/log'),
  exportCsvUrl:  (p={})=> `${BASE}/export/csv?${qs(p)}`,
}

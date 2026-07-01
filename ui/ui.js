const state = { artifact: null, svg: "", files: {} }
const $ = (id) => document.getElementById(id)

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
  return `{${entries.join(',')}}`
}
async function sha256(input) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function mutation(type, source_ref) {
  return { type, source_ref, mutation_hash: `sha256:${await sha256(canonicalize({ type, source_ref }))}` }
}
async function computeCrystalHash(artifact) {
  const mutation_hashes = [...artifact.mutations.map((m) => m.mutation_hash)].sort((a,b) => a.localeCompare(b))
  return `sha256:${await sha256(canonicalize({ crystal_version: artifact.crystal_version, receipt_root: artifact.receipt_root, mutation_hashes }))}`
}
function f(n){ return n.toFixed(4) }
function hashToUint32(seed, offset){ return parseInt(seed.slice(offset, offset + 8), 16) >>> 0 }
function layerPath(cx, cy, baseRadius, hash, layerIndex) {
  const sideSeed = hashToUint32(hash, (layerIndex * 8) % (hash.length - 8))
  const sides = 6 + (sideSeed % 5)
  const rotation = (hashToUint32(hash, (layerIndex * 10 + 4) % (hash.length - 8)) / 0xffffffff) * Math.PI * 2
  const jitter = (hashToUint32(hash, (layerIndex * 12 + 6) % (hash.length - 8)) / 0xffffffff) * 0.12 + 0.88
  const radius = baseRadius + layerIndex * 18
  const points = []
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (Math.PI * 2 * i) / sides
    const radialBias = 0.82 + (((hashToUint32(hash, (i * 4 + layerIndex * 3) % (hash.length - 8)) / 0xffffffff) * 0.34) * jitter)
    const x = cx + Math.cos(angle) * radius * radialBias
    const y = cy + Math.sin(angle) * radius * (0.7 + radialBias * 0.25)
    points.push(`${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`)
  }
  return `${points.join(' ')} Z`
}
async function renderQr(payload) {
  return new Promise((resolve, reject) => {
    QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'H', margin: 0, width: 220, color: { dark: '#111111', light: '#ffffff' } }, (err, svg) => err ? reject(err) : resolve(svg.replace(/<\?xml[^>]*>/g, '').replace(/<!DOCTYPE[^>]*>/g, '').replace(/\r?\n/g, '').trim()))
  })
}
async function renderArtifactSvg(artifact) {
  const payload = canonicalize(artifact)
  const qrSvg = await renderQr(payload)
  const hash = artifact.crystal_hash.replace(/^sha256:/, '')
  const receiptSeed = artifact.receipt_root.replace(/^0x/, '')
  const width = 1200, height = 1600, cx = 420, cy = 620
  const baseRadius = 120 + (hashToUint32(receiptSeed, 0) % 40)
  const layers = artifact.mutations.map((m, i) => {
    const d = layerPath(cx, cy, baseRadius, m.mutation_hash.replace(/^sha256:/, ''), i)
    const hue = hashToUint32(m.mutation_hash.replace(/^sha256:/, ''), 0) % 360
    const opacity = 0.18 + i * 0.11
    return `<path d="${d}" fill="hsla(${hue},70%,65%,${f(Math.min(opacity, 0.82))})" stroke="#0f172a" stroke-width="2.0000" />`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc" /><g>${layers}</g><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(baseRadius*0.42)}" fill="#e2e8f0" stroke="#0f172a" stroke-width="2.0000" /><text x="80" y="116" font-family="monospace" font-size="34">Crystal Artifact v0</text><text x="80" y="154" font-family="monospace" font-size="18">mutation_count: ${artifact.mutation_count}</text><text x="80" y="186" font-family="monospace" font-size="18">receipt_root: ${artifact.receipt_root}</text><text x="80" y="218" font-family="monospace" font-size="18">portfolio_root: ${artifact.portfolio_root}</text><text x="80" y="250" font-family="monospace" font-size="18">crystal_hash: ${artifact.crystal_hash}</text>${artifact.mutations.map((m, i) => `<text x="80" y="${f(1030 + i * 36)}" font-family="monospace" font-size="16">${i+1}. ${m.type} → ${m.source_ref}</text>`).join('')}<g transform="translate(830,1180)">${qrSvg.replace(/<svg[^>]*>|<\/svg>/g, '')}</g><text x="830" y="1160" font-family="monospace" font-size="18">scan to verify offline</text></svg>`
}
async function generate() {
  const proof = state.files.proof
  const entry = state.files.entry
  const portfolio = state.files.portfolio
  if (!proof || !entry || !portfolio) return alert('Load three JSON files first.')
  const stableId = portfolio.portfolio_id
  const mutations = [
    await mutation('evidence_imported', stableId),
    await mutation('receipt_verified', stableId),
    await mutation('chronicle_entry_created', stableId),
    await mutation('portfolio_created', stableId),
    await mutation('portfolio_verified', stableId),
  ]
  const artifact = { crystal_version: 'crystal_artifact.v0', receipt_root: proof.receipt_root, portfolio_root: portfolio.portfolio_root, mutation_count: mutations.length, mutations, crystal_hash: '' }
  artifact.crystal_hash = await computeCrystalHash(artifact)
  state.artifact = artifact
  state.svg = await renderArtifactSvg(artifact)
  $('mutationCount').textContent = String(artifact.mutation_count)
  $('crystalHash').textContent = artifact.crystal_hash
  $('preview').innerHTML = state.svg
}
for (const [id, key] of [['proof','proof'],['entry','entry'],['portfolio','portfolio']]) {
  $(id).addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    state.files[key] = JSON.parse(await file.text())
  })
}
$('generate').addEventListener('click', () => void generate())
$('exportSvg').addEventListener('click', () => {
  if (!state.svg) return
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([state.svg], { type: 'image/svg+xml' })); a.download = 'crystal_artifact.svg'; a.click()
})
$('exportJson').addEventListener('click', () => {
  if (!state.artifact) return
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state.artifact, null, 2)], { type: 'application/json' })); a.download = 'crystal_artifact.v0.json'; a.click()
})
$('copyHash').addEventListener('click', async () => { if (state.artifact) await navigator.clipboard.writeText(state.artifact.crystal_hash) })

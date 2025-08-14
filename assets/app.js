/* MonoDiff app logic */

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

const els = {
  a: $('#inputA'),
  b: $('#inputB'),
  pasteA: $('#pasteA'),
  pasteB: $('#pasteB'),
  clearA: $('#clearA'),
  clearB: $('#clearB'),
  modeBtns: $$('.mode-btn'),
  viewBtns: $$('.view-btn'),
  tokenBtns: $$('.token-btn'),
  onlyChangesToggle: $('#onlyChangesToggle'),
  topBtn: $('#topBtn'),
  themeToggle: $('#themeToggle'),
  beautifyBtn: $('#beautifyBtn'),
  swapInputs: $('#swapInputs'),
  diffOutput: $('#diffOutput'),
  diffContainer: $('#diffContainer'),
  summary: $('#summary'),
  prev: $('#prevBtn'),
  next: $('#nextBtn'),
  navCounter: $('#navCounter'),
}

let state = {
  mode: 'text', // 'text' | 'json'
  view: 'unified', // 'unified' | 'split'
  chunks: [], // diff chunks from jsdiff
  changeAnchors: [], // DOM elements for navigation
  changeIndex: 0,
  granularity: 'line', // 'line' | 'inline'
  token: 'word', // 'word' | 'char' (for inline granularity)
  jsonTokenActive: false, // when true, use word/char inline diff for JSON
  onlyChanges: false,
  aText: '',
  bText: '',
  theme: 'dark',
}

function setMode(newMode) {
  state.mode = newMode
  const dark = state.theme !== 'light'
  els.modeBtns.forEach((b) => {
    const on = b.dataset.mode === newMode
    // clear both theme variants
    b.classList.remove('bg-white/10', 'text-slate-100', 'bg-slate-200', 'text-slate-900', 'soft-selected')
    // apply theme-aware selected styles
    if (on) {
      if (dark) {
        b.classList.add('bg-white/10', 'text-slate-100')
      } else {
        b.classList.add('soft-selected')
      }
    }
  })
}

function setView(newView) {
  state.view = newView
  try { localStorage.setItem('view', newView) } catch {}
  const dark = state.theme !== 'light'
  els.viewBtns.forEach((b) => {
    const on = b.dataset.view === newView
    b.classList.remove('bg-white/10', 'text-slate-100', 'bg-slate-200', 'text-slate-900', 'soft-selected')
    if (on) {
      if (dark) {
        b.classList.add('bg-white/10', 'text-slate-100')
      } else {
        b.classList.add('soft-selected')
      }
    }
  })
  renderCurrent()
}

function setToken(newToken) {
  state.token = newToken
  // If user selects Line, force line diff (also for JSON). Otherwise enable inline for JSON.
  state.jsonTokenActive = newToken !== 'line'
  try { localStorage.setItem('token', newToken) } catch {}
  // Show Only Changes toggle only in line mode; disable it when hiding
  if (els.onlyChangesToggle) {
    const show = newToken === 'line'
    els.onlyChangesToggle.style.display = show ? '' : 'none'
    if (!show && state.onlyChanges) {
      setOnlyChanges(false)
    }
  }
  const dark = state.theme !== 'light'
  els.tokenBtns.forEach((b) => {
    const on = b.dataset.token === newToken
    b.classList.remove('bg-white/10', 'text-slate-100', 'bg-slate-200', 'text-slate-900', 'soft-selected')
    if (on) {
      if (dark) {
        b.classList.add('bg-white/10', 'text-slate-100')
      } else {
        b.classList.add('soft-selected')
      }
    }
  })
  // Recompute diff to switch tokenizer if applicable
  compare()
}

function setOnlyChanges(on) {
  state.onlyChanges = on
  try { localStorage.setItem('onlyChanges', on ? '1' : '0') } catch {}
  if (els.onlyChangesToggle) {
    els.onlyChangesToggle.setAttribute('aria-pressed', on ? 'true' : 'false')
    const dot = els.onlyChangesToggle.querySelector('.toggle-dot')
    if (dot) {
      dot.style.transform = on ? 'translateX(1.25rem)' : 'translateX(0.125rem)'
      dot.classList.toggle('bg-indigo-400', on)
      dot.classList.toggle('bg-slate-400', !on)
    }
  }
  renderCurrent()
}

function prettyJSON(input) {
  try {
    if (typeof input !== 'string') return JSON.stringify(input, null, 2)
    const obj = JSON.parse(input)
    return JSON.stringify(obj, null, 2)
  } catch (e) {
    // not valid JSON, return raw
    return input
  }
}

// Auto-detect helper: is the given string valid JSON?
function isJSON(str) {
  if (typeof str !== 'string') return false
  const s = str.trim()
  if (!s) return false
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

function computeDiff(a, b, mode) {
  if (mode === 'json') {
    a = prettyJSON(a)
    b = prettyJSON(b)
    if (state.token === 'line') {
      state.granularity = 'line'
      return Diff.diffLines(a, b, { newlineIsToken: true })
    }
    if (state.jsonTokenActive) {
      // Inline token diff for JSON when user chose Word/Char
      state.granularity = 'inline'
      return state.token === 'char' ? Diff.diffChars(a, b) : Diff.diffWordsWithSpace(a, b)
    }
  }
  // Text: prefer line diff, fallback to word diff for single-line inputs
  if (mode === 'text') {
    if (state.token === 'line') {
      state.granularity = 'line'
      return Diff.diffLines(a, b, { newlineIsToken: true })
    }
    // When user chose Word/Char for text, always do inline diff across the whole string
    // so differences like space vs newline are highlighted minimally.
    state.granularity = 'inline'
    return state.token === 'char' ? Diff.diffChars(a, b) : Diff.diffWordsWithSpace(a, b)
  }
  // Default to line-based
  state.granularity = 'line'
  return Diff.diffLines(a, b, { newlineIsToken: true })
}

function summarize(chunks) {
  // Robust summary regardless of diff type
  let added = 0
  let removed = 0
  for (const c of chunks) {
    if (c.added) {
      added += unitCount(c)
    } else if (c.removed) {
      removed += unitCount(c)
    }
  }
  els.summary.textContent = `+${added} −${removed}`
}

function unitCount(c) {
  if (state.granularity === 'line') {
    if (typeof c.count === 'number') return c.count
    // fallback: count lines
    if (c.value === '\n') return 1
    const parts = c.value.split('\n')
    // If the value ended with a trailing newline, split will include a final empty string;
    // since newlineIsToken=true, that trailing newline should arrive as its own token, so we count as-is.
    return parts.filter(() => true).length
  }
  // inline granularity: count tokens according to state.token
  if (state.token === 'char') {
    return c.value.length
  }
  const t = c.value.trim()
  if (!t) return 0
  return t.split(/\s+/).length
}

function renderUnified(chunks, { onlyChanges }) {
  els.diffOutput.innerHTML = ''
  state.changeAnchors = []
  state.changeIndex = 0
  // line numbers for unified view
  state.uniLine = 1

  // Build DOM fragments
  const frag = document.createDocumentFragment()

  // Group chunks into blocks: changed vs unchanged
  let blockId = 0
  for (const ch of chunks) {
    const isChange = !!(ch.added || ch.removed)
    // Preserve newline tokens: if value is exactly "\n", render as a single visible literal
    const lines = ch.value === '\n' ? ['\\n'] : ch.value.split('\n')
    const block = document.createElement('div')
    block.dataset.blockId = String(blockId++)
    block.className = 'transition-colors'

    if (!isChange && onlyChanges) {
      // Collapsed spacer for unchanged block
      const count = lines.length
      const startAt = state.uniLine
      // advance global line counter to keep following change blocks aligned
      state.uniLine += count || 0

      const spacer = document.createElement('button')
      spacer.type = 'button'
      spacer.className = 'collapse w-full max-h-14 opacity-70 hover:opacity-100 text-xs text-slate-400 px-3 py-2 my-1 rounded-lg border border-white/10 bg-white/5'
      spacer.textContent = count > 0 ? `··· ${count} unchanged line${count !== 1 ? 's' : ''} ···` : ' '
      spacer.addEventListener('click', () => {
        // Expand with correct starting line numbers
        spacer.remove()
        const full = renderLinesAt(lines, 'unchanged', startAt)
        block.appendChild(full)
      })
      block.appendChild(spacer)
    } else {
      const type = ch.added ? 'added' : ch.removed ? 'removed' : 'unchanged'
      const el = renderLines(lines, type)
      block.appendChild(el)

      if (isChange) {
        block.classList.add('diff-token')
        block.classList.add('rounded-lg')
        block.classList.add('my-1')
        block.dataset.change = '1'
        state.changeAnchors.push(block)
      }
    }

    frag.appendChild(block)
  }

  els.diffOutput.appendChild(frag)

  // Summary
  summarize(chunks)

  updateNavCounter()
}

function renderSplit(chunks, { onlyChanges }) {
  els.diffOutput.innerHTML = ''
  state.changeAnchors = []
  state.changeIndex = 0

  const container = document.createElement('div')
  // line numbers per pane for split view
  state.splitLeft = 1
  state.splitRight = 1
  container.className = 'grid grid-cols-2 gap-3'

  // Pair removed with subsequent added when possible
  const pairs = []
  const toLines = (c) => (c.value === '\n' ? ['\\n'] : c.value.split('\n'))
  let i = 0
  while (i < chunks.length) {
    const c = chunks[i]
    if (c.removed) {
      const left = toLines(c)
      let right = []
      if (i + 1 < chunks.length && chunks[i + 1].added) {
        right = toLines(chunks[i + 1])
        i += 2
      } else {
        i += 1
      }
      pairs.push({ type: 'change', left, right })
    } else if (c.added) {
      pairs.push({ type: 'change', left: [], right: toLines(c) })
      i += 1
    } else {
      const lines = toLines(c)
      pairs.push({ type: 'equal', left: lines, right: lines })
      i += 1
    }
  }

  for (const p of pairs) {
    const block = document.createElement('div')
    block.className = 'col-span-2'

    if (p.type === 'equal' && onlyChanges) {
      const count = Math.max(p.left.length, p.right.length)
      const startL = state.splitLeft
      const startR = state.splitRight
      // advance global counters to keep subsequent change blocks aligned
      state.splitLeft += p.left.length
      state.splitRight += p.right.length

      const spacer = document.createElement('button')
      spacer.type = 'button'
      spacer.className = 'collapse w-full max-h-14 opacity-70 hover:opacity-100 text-xs text-slate-400 px-3 py-2 my-1 rounded-lg border border-white/10 bg-white/5'
      spacer.textContent = count > 0 ? `··· ${count} unchanged line${count !== 1 ? 's' : ''} ···` : ' '
      spacer.addEventListener('click', () => {
        spacer.remove()
        block.appendChild(renderSplitRowGroupAt(p, startL, startR))
      })
      block.appendChild(spacer)
    } else {
      const group = renderSplitRowGroup(p)
      block.appendChild(group)
      if (p.type === 'change') {
        block.classList.add('diff-token', 'rounded-lg', 'my-1')
        state.changeAnchors.push(block)
      }
    }

    container.appendChild(block)
  }

  els.diffOutput.appendChild(container)

  const added = chunks.filter((c) => c.added).reduce((n, c) => n + c.count, 0)
  const removed = chunks.filter((c) => c.removed).reduce((n, c) => n + c.count, 0)
  els.summary.textContent = `+${added || 0} −${removed || 0}`

  updateNavCounter()
}

function renderSplitRowGroup(p) {
  const wrap = document.createElement('div')
  wrap.className = 'grid grid-cols-2 gap-3'

  const leftCol = document.createElement('div')
  const rightCol = document.createElement('div')

  const maxLen = Math.max(p.left.length, p.right.length)
  for (let idx = 0; idx < maxLen; idx++) {
    const l = p.left[idx]
    const r = p.right[idx]
    const leftRow = document.createElement('div')
    const rightRow = document.createElement('div')
    if (p.type === 'equal') {
      leftRow.className = rowClass('unchanged')
      rightRow.className = rowClass('unchanged')
    } else {
      leftRow.className = rowClass(l !== undefined ? 'removed' : 'unchanged')
      rightRow.className = rowClass(r !== undefined ? 'added' : 'unchanged')
    }
    leftRow.innerHTML = `
      <div class="w-10 text-right text-xs text-slate-500 tabular-nums select-none pr-1">${l !== undefined ? (state.splitLeft++) : ''}</div>
      <div class="min-w-[24px] text-slate-500">${p.type === 'equal' ? ' ' : l !== undefined ? '−' : ' '}</div>
      <div class="whitespace-pre-wrap break-words flex-1">${escapeHTML(l ?? '')}</div>
    `
    rightRow.innerHTML = `
      <div class="w-10 text-right text-xs text-slate-500 tabular-nums select-none pr-1">${r !== undefined ? (state.splitRight++) : ''}</div>
      <div class="min-w-[24px] text-slate-500">${p.type === 'equal' ? ' ' : r !== undefined ? '+' : ' '}</div>
      <div class="whitespace-pre-wrap break-words flex-1">${escapeHTML(r ?? '')}</div>
    `
    leftCol.appendChild(leftRow)
    rightCol.appendChild(rightRow)
  }

  wrap.appendChild(leftCol)
  wrap.appendChild(rightCol)
  return wrap
}

// Render split rows starting from explicit line numbers without mutating global counters
function renderSplitRowGroupAt(p) {
  const wrap = document.createElement('div')
  wrap.className = 'grid grid-cols-2 gap-3'

  const leftCol = document.createElement('div')
  const rightCol = document.createElement('div')

  let startL = arguments[1]
  let startR = arguments[2]
  const maxLen = Math.max(p.left.length, p.right.length)
  for (let idx = 0; idx < maxLen; idx++) {
    const l = p.left[idx]
    const r = p.right[idx]
    const leftRow = document.createElement('div')
    const rightRow = document.createElement('div')
    if (p.type === 'equal') {
      leftRow.className = rowClass('unchanged')
      rightRow.className = rowClass('unchanged')
    } else {
      leftRow.className = rowClass(l !== undefined ? 'removed' : 'unchanged')
      rightRow.className = rowClass(r !== undefined ? 'added' : 'unchanged')
    }
    leftRow.innerHTML = `
      <div class="w-10 text-right text-xs text-slate-500 tabular-nums select-none pr-1">${l !== undefined ? (startL++) : ''}</div>
      <div class="min-w-[24px] text-slate-500">${p.type === 'equal' ? ' ' : l !== undefined ? '−' : ' '}</div>
      <div class="whitespace-pre-wrap break-words flex-1">${escapeHTML(l ?? '')}</div>
    `
    rightRow.innerHTML = `
      <div class="w-10 text-right text-xs text-slate-500 tabular-nums select-none pr-1">${r !== undefined ? (startR++) : ''}</div>
      <div class="min-w-[24px] text-slate-500">${p.type === 'equal' ? ' ' : r !== undefined ? '+' : ' '}</div>
      <div class="whitespace-pre-wrap break-words flex-1">${escapeHTML(r ?? '')}</div>
    `
    leftCol.appendChild(leftRow)
    rightCol.appendChild(rightRow)
  }

  wrap.appendChild(leftCol)
  wrap.appendChild(rightCol)
  return wrap
}

function renderLines(lines, type) {
  const wrap = document.createElement('div')
  for (const ln of lines) {
    const row = document.createElement('div')
    row.className = rowClass(type)
    const symbol = type === 'added' ? '+' : type === 'removed' ? '−' : ' '

    row.innerHTML = `
      <div class="w-10 text-right text-xs text-slate-500 tabular-nums select-none pr-1">${state.uniLine ?? ''}</div>
      <div class="min-w-[24px] text-slate-500">${symbol}</div>
      <div class="whitespace-pre-wrap break-words flex-1">${escapeHTML(ln)}</div>
    `
    // increment unified line number if enabled
    if (typeof state.uniLine === 'number') state.uniLine++

    wrap.appendChild(row)
  }
  return wrap
}

// Render unified lines with an explicit starting line number (does not mutate state.uniLine)
function renderLinesAt(lines, type, startAt) {
  const wrap = document.createElement('div')
  let n = startAt
  for (const ln of lines) {
    const row = document.createElement('div')
    row.className = rowClass(type)
    const symbol = type === 'added' ? '+' : type === 'removed' ? '−' : ' '
    row.innerHTML = `
      <div class="w-10 text-right text-xs text-slate-500 tabular-nums select-none pr-1">${n}</div>
      <div class="min-w-[24px] text-slate-500">${symbol}</div>
      <div class="whitespace-pre-wrap break-words flex-1">${escapeHTML(ln)}</div>
    `
    n++
    wrap.appendChild(row)
  }
  return wrap
}

function rowClass(type) {
  const dark = state.theme !== 'light'
  const base = 'flex gap-3 px-3 py-1.5 rounded-md transition-colors'
  if (type === 'added') {
    return base + (dark ? ' bg-emerald-500/10 text-emerald-200' : ' bg-emerald-100 text-emerald-900')
  }
  if (type === 'removed') {
    return base + (dark ? ' bg-rose-500/10 text-rose-200' : ' bg-rose-100 text-rose-900')
  }
  // unchanged
  return base + (dark ? ' hover:bg-white/5 text-slate-300' : ' hover:bg-slate-100 text-slate-800')
}

// Inline token class (for word/char diffs)
function tokenClass(kind) {
  const dark = state.theme !== 'light'
  if (kind === 'added') {
    return dark ? 'bg-emerald-500/20 text-emerald-200 px-0.5 rounded' : 'bg-emerald-200 text-emerald-900 px-0.5 rounded'
  }
  if (kind === 'removed') {
    return dark
      ? 'bg-rose-500/20 text-rose-200 px-0.5 rounded line-through decoration-rose-300/70'
      : 'bg-rose-200 text-rose-900 px-0.5 rounded line-through decoration-rose-600/70'
  }
  return ''
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Theme-aware UI for Only Changes toggle
function updateOnlyChangesUI() {
  if (!els.onlyChangesToggle) return
  const btn = els.onlyChangesToggle
  const track = btn.querySelector('.toggle-track')
  const dot = btn.querySelector('.toggle-dot')
  if (!track || !dot) return
  const pressed = btn.getAttribute('aria-pressed') === 'true'
  const dark = state.theme !== 'light'
  // Reset classes
  track.classList.remove('bg-white/10','border-white/10','bg-indigo-500/20','border-indigo-400/30','bg-indigo-200','border-indigo-300','bg-slate-200','border-slate-300')
  dot.classList.remove('translate-x-0.5','translate-x-4','bg-slate-400','bg-indigo-400','bg-indigo-600','bg-slate-500')
  btn.classList.remove('soft-selected')
  // Apply by state
  if (pressed) {
    if (dark) {
      track.classList.add('bg-indigo-500/20','border-indigo-400/30')
      dot.classList.add('translate-x-4','bg-indigo-400')
    } else {
      track.classList.add('bg-indigo-200','border-indigo-300')
      dot.classList.add('translate-x-4','bg-indigo-600')
      btn.classList.add('soft-selected')
    }
  } else {
    if (dark) {
      track.classList.add('bg-white/10','border-white/10')
      dot.classList.add('translate-x-0.5','bg-slate-400')
    } else {
      track.classList.add('bg-slate-200','border-slate-300')
      dot.classList.add('translate-x-0.5','bg-slate-500')
    }
  }
}

function scrollToChange(idx) {
  if (state.changeAnchors.length === 0) return
  const i = ((idx % state.changeAnchors.length) + state.changeAnchors.length) % state.changeAnchors.length
  state.changeIndex = i
  updateNavCounter()
  const el = state.changeAnchors[i]
  $$('.diff-focus').forEach((n) => n.classList.remove('diff-focus'))
  el.classList.add('diff-focus')
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function updateNavCounter() {
  els.navCounter.textContent = `${state.changeAnchors.length ? state.changeIndex + 1 : 0} / ${state.changeAnchors.length}`
}

function compare() {
  const a = els.a.value || ''
  const b = els.b.value || ''
  state.aText = a
  state.bText = b
  // If both inputs are empty, clear the diff UI entirely
  if (a === '' && b === '') {
    state.chunks = []
    els.diffOutput.innerHTML = ''
    els.summary.textContent = ''
    state.changeAnchors = []
    state.changeIndex = 0
    updateNavCounter()
    return
  }
  // Auto-detect mode: use JSON mode only if both sides are valid JSON
  const detectedMode = isJSON(a) && isJSON(b) ? 'json' : 'text'
  state.mode = detectedMode
  const chunks = computeDiff(a, b, detectedMode)
  state.chunks = chunks
  renderCurrent()
}

function renderCurrent() {
  if (state.granularity === 'inline') {
    if (state.view === 'split') {
      renderWordSplit(state.chunks)
    } else {
      renderWordUnified(state.chunks)
    }
  } else {
    if (state.view === 'split') {
      renderSplit(state.chunks, { onlyChanges: state.onlyChanges })
    } else {
      renderUnified(state.chunks, { onlyChanges: state.onlyChanges })
    }
  }
}

function renderWordUnified(chunks) {
  els.diffOutput.innerHTML = ''
  state.changeAnchors = []
  state.changeIndex = 0

  // If Only Changes: compute sentence context range on B text and filter chunks
  if (state.onlyChanges) {
    chunks = filterInlineChunksBySentenceContext(chunks, state.bText)
  }

  const block = document.createElement('div')
  block.className = state.theme === 'light' ? 'my-1 rounded-lg px-3 py-2 bg-slate-50' : 'my-1 rounded-lg px-3 py-2 bg-white/5'

  const row = document.createElement('div')
  row.className = 'flex gap-3 items-start'

  const sym = document.createElement('div')
  sym.className = 'min-w-[24px] text-slate-500'
  sym.textContent = ' '
  row.appendChild(sym)

  const content = document.createElement('div')
  content.className = 'whitespace-pre-wrap break-words flex-1'
  for (const c of chunks) {
    const span = document.createElement('span')
    span.textContent = c.value
    if (c.added) span.className = tokenClass('added')
    else if (c.removed) span.className = tokenClass('removed')
    content.appendChild(span)
  }
  row.appendChild(content)
  block.appendChild(row)
  block.classList.add('diff-token')
  state.changeAnchors.push(block)
  els.diffOutput.appendChild(block)

  summarize(chunks)
  updateNavCounter()
}

// Helpers: sentence context filtering for inline diffs
function filterInlineChunksBySentenceContext(chunks, bText) {
  // Build B text and map each chunk to B offsets
  let bOffset = 0
  const map = chunks.map((c) => {
    const start = bOffset
    if (!c.removed) bOffset += c.value.length
    return { start, end: c.removed ? start : bOffset }
  })
  const firstAdded = chunks.findIndex((c) => c.added)
  const lastAdded = (() => {
    for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i].added) return i
    return -1
  })()
  if (firstAdded === -1 || lastAdded === -1) return chunks // no additions; show original

  const changeStart = map[firstAdded].start
  const changeEnd = map[lastAdded].end
  const [sentences, indices] = splitIntoSentencesWithIndices(bText)
  // Find sentence containing changeStart and changeEnd
  let sIdx = 0
  while (sIdx < indices.length && !(indices[sIdx].start <= changeStart && changeStart <= indices[sIdx].end)) sIdx++
  let eIdx = sIdx
  while (eIdx < indices.length && !(indices[eIdx].start <= changeEnd && changeEnd <= indices[eIdx].end)) eIdx++
  if (sIdx >= indices.length) sIdx = 0
  if (eIdx >= indices.length) eIdx = sentences.length - 1
  // add one sentence of context on each side
  const ctxStartIdx = Math.max(0, sIdx - 1)
  const ctxEndIdx = Math.min(sentences.length - 1, eIdx + 1)
  const ctxStart = indices[ctxStartIdx].start
  const ctxEnd = indices[ctxEndIdx].end

  // Determine which chunks overlap with [ctxStart, ctxEnd)
  const firstKeep = map.findIndex((m) => m.end > ctxStart)
  let lastKeep = map.length - 1
  for (let i = map.length - 1; i >= 0; i--) {
    if (map[i].start < ctxEnd) { lastKeep = i; break }
  }

  const sliced = []
  for (let i = Math.max(0, firstKeep); i <= Math.max(firstKeep, lastKeep); i++) {
    const c = chunks[i]
    const pos = map[i]
    if (c.removed) {
      // keep removed tokens if they fall between kept non-removed tokens
      sliced.push(c)
    } else {
      const keepStart = Math.max(0, ctxStart - pos.start)
      const keepEnd = Math.min(c.value.length, ctxEnd - pos.start)
      if (keepEnd > keepStart) {
        sliced.push({ ...c, value: c.value.slice(keepStart, keepEnd) })
      }
    }
  }
  return sliced
}

function splitIntoSentencesWithIndices(text) {
  const parts = []
  const indices = []
  const regex = /[^.!?\n]+[.!?]?\s*/g
  let m
  let offset = 0
  while ((m = regex.exec(text)) !== null) {
    const seg = m[0]
    const start = m.index
    const end = start + seg.length
    parts.push(seg)
    indices.push({ start, end })
    offset = end
  }
  if (parts.length === 0) {
    parts.push(text)
    indices.push({ start: 0, end: text.length })
  }
  return [parts, indices]
}

function renderWordSplit(chunks) {
  els.diffOutput.innerHTML = ''
  state.changeAnchors = []
  state.changeIndex = 0

  // If Only Changes: compute sentence context range on B text and filter chunks
  if (state.onlyChanges) {
    chunks = filterInlineChunksBySentenceContext(chunks, state.bText)
  }

  const container = document.createElement('div')
  container.className = 'grid grid-cols-2 gap-3'

  const left = document.createElement('div')
  const right = document.createElement('div')

  const leftRow = document.createElement('div')
  leftRow.className = rowClass('unchanged')
  const rightRow = document.createElement('div')
  rightRow.className = rowClass('unchanged')

  // Build left (base - removals highlighted)
  const leftSym = document.createElement('div')
  leftSym.className = 'min-w-[24px] text-slate-500'
  leftSym.textContent = ' '
  const leftContent = document.createElement('div')
  leftContent.className = 'whitespace-pre-wrap break-words flex-1'
  // Build right (target - additions highlighted)
  const rightSym = document.createElement('div')
  rightSym.className = 'min-w-[24px] text-slate-500'
  rightSym.textContent = ' '
  const rightContent = document.createElement('div')
  rightContent.className = 'whitespace-pre-wrap break-words flex-1'

  for (const c of chunks) {
    const text = c.value
    const lspan = document.createElement('span')
    const rspan = document.createElement('span')
    if (c.removed) lspan.className = tokenClass('removed')
    if (c.added) rspan.className = tokenClass('added')
    lspan.textContent = c.added ? '' : text
    rspan.textContent = c.removed ? '' : text
    leftContent.appendChild(lspan)
    rightContent.appendChild(rspan)
  }

  leftRow.appendChild(leftSym)
  leftRow.appendChild(leftContent)
  rightRow.appendChild(rightSym)
  rightRow.appendChild(rightContent)

  left.appendChild(leftRow)
  right.appendChild(rightRow)

  const block = document.createElement('div')
  block.className = 'col-span-2 grid grid-cols-2 gap-3 diff-token rounded-lg my-1'
  block.appendChild(left)
  block.appendChild(right)

  state.changeAnchors.push(block)
  container.appendChild(block)
  els.diffOutput.appendChild(container)

  summarize(chunks)
  updateNavCounter()
}

// Clipboard helpers
async function tryPaste(target) {
  try {
    const text = await navigator.clipboard.readText()
    const maybePretty = isJSON(text) ? prettyJSON(text) : text
    target.value = maybePretty
    compare()
  } catch (e) {
    // ignore
  }
}

// Event wiring
function init() {
  // Default mode highlight
  // mode auto-detected; no manual toggle
  // Restore persisted prefs
  const savedView = (localStorage.getItem('view') || 'unified')
  const savedToken = (localStorage.getItem('token') || 'word')
  const savedOnly = localStorage.getItem('onlyChanges') === '1'
  const savedA = localStorage.getItem('inputA')
  const savedB = localStorage.getItem('inputB')

  if (typeof savedA === 'string') els.a.value = savedA
  if (typeof savedB === 'string') els.b.value = savedB

  // Apply Only Changes first, then token (token may hide/disable it)
  setOnlyChanges(savedOnly)
  setView(savedView)
  setToken(savedToken)

  // Theme init
  const applyTheme = (t) => {
    const html = document.documentElement
    const body = document.body
    if (t === 'light') {
      html.classList.remove('dark')
      html.classList.add('theme-light')
      els.themeToggle && (els.themeToggle.textContent = '☀️')
      body.classList.remove('bg-base-50', 'text-slate-200')
      body.classList.add('bg-white', 'text-slate-800')
      state.theme = 'light'
    } else {
      html.classList.add('dark')
      html.classList.remove('theme-light')
      els.themeToggle && (els.themeToggle.textContent = '🌙')
      body.classList.remove('bg-white', 'text-slate-800')
      body.classList.add('bg-base-50', 'text-slate-200')
      state.theme = 'dark'
    }
  }
  const savedTheme = localStorage.getItem('theme') || 'dark'
  applyTheme(savedTheme)
  if (state.chunks && state.chunks.length) {
    renderCurrent()
  }
  // apply current selections with theme-aware styles
  // mode auto-detected; no manual toggle
  setView(state.view)
  setToken(state.token)
  // sync Only Changes toggle visuals
  updateOnlyChangesUI()
  if (els.onlyChangesToggle) {
    els.onlyChangesToggle.addEventListener('click', () => {
      // allow any existing handlers to flip aria-pressed first
      setTimeout(updateOnlyChangesUI, 0)
    })
  }
  if (els.themeToggle) {
    els.themeToggle.addEventListener('click', () => {
      const next = (localStorage.getItem('theme') || 'dark') === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', next)
      applyTheme(next)
      renderCurrent()
      // reapply selections after theme change
      // mode auto-detected; no manual toggle
      setView(state.view)
      setToken(state.token)
      updateOnlyChangesUI()
    })
  }

  // Remove JSON/Text toggle: disable mode buttons and rely on auto-detect
  // els.modeBtns.forEach((btn) =>
  //   btn.addEventListener('click', () => {
  //     setMode(btn.dataset.mode)
  //     compare()
  //   })
  // )

  els.viewBtns.forEach((btn) =>
    btn.addEventListener('click', () => setView(btn.dataset.view))
  )

  els.tokenBtns.forEach((btn) =>
    btn.addEventListener('click', () => setToken(btn.dataset.token))
  )

  if (els.onlyChangesToggle) {
    els.onlyChangesToggle.addEventListener('click', () => setOnlyChanges(!state.onlyChanges))
  }

  // compare button removed; rely on auto-compare and other triggers

  els.prev.addEventListener('click', () => scrollToChange(state.changeIndex - 1))
  els.next.addEventListener('click', () => scrollToChange(state.changeIndex + 1))
  if (els.topBtn) {
    els.topBtn.addEventListener('click', () => {
      // scroll diffOutput if overflowing, else window
      if (els.diffOutput && els.diffOutput.scrollHeight > els.diffOutput.clientHeight) {
        els.diffOutput.scrollTo({ top: 0, behavior: 'smooth' })
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  // Swap inputs
  if (els.swapInputs) {
    els.swapInputs.addEventListener('click', () => {
      const tmp = els.a.value
      els.a.value = els.b.value
      els.b.value = tmp
      compare()
    })
  }

  // Beautify JSON in both inputs (only for objects/arrays to avoid surprising primitives)
  if (els.beautifyBtn) {
    els.beautifyBtn.addEventListener('click', () => {
      const isObjOrArr = (s) => {
        if (typeof s !== 'string') return false
        const t = s.trim()
        if (!t) return false
        if (!(t.startsWith('{') || t.startsWith('['))) return false
        try {
          const parsed = JSON.parse(t)
          return parsed !== null && typeof parsed === 'object'
        } catch {
          return false
        }
      }
      if (isObjOrArr(els.a.value)) {
        els.a.value = prettyJSON(els.a.value)
      }
      if (isObjOrArr(els.b.value)) {
        els.b.value = prettyJSON(els.b.value)
      }
      compare()
    })
  }

  // Debounced auto-compare on input changes
  const debounce = (fn, ms = 300) => {
    let t
    return (...args) => {
      clearTimeout(t)
      t = setTimeout(() => fn(...args), ms)
    }
  }
  const autoCompare = debounce(() => {
    try {
      localStorage.setItem('inputA', els.a.value || '')
      localStorage.setItem('inputB', els.b.value || '')
    } catch {}
    compare()
  }, 250)
  els.a.addEventListener('input', autoCompare)
  els.b.addEventListener('input', autoCompare)

  els.pasteA.addEventListener('click', () => tryPaste(els.a))
  els.pasteB.addEventListener('click', () => tryPaste(els.b))
  els.clearA.addEventListener('click', () => {
    els.a.value = ''
    try { localStorage.setItem('inputA', '') } catch {}
    compare()
  })
  els.clearB.addEventListener('click', () => {
    els.b.value = ''
    try { localStorage.setItem('inputB', '') } catch {}
    compare()
  })

  // If no saved inputs, seed demo and compute once
  if (!savedA && !savedB) {
    const demoA = '{\n  "name": "MonoDiff",\n  "version": 1,\n  "features": ["text", "json"]\n}'
    const demoB = '{\n  "name": "MonoDiff",\n  "version": 2,\n  "features": ["text", "json", "nav"],\n  "minimal": true\n}'
    els.a.value = demoA
    els.b.value = demoB
  }
  compare()
}

document.addEventListener('DOMContentLoaded', init)

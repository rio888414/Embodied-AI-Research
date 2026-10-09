/* ============================================================
   智元 Genie 科研合作 · 应用逻辑
   ============================================================ */

/* ---------- 云服务公共配置（来自云服务开通返回） ---------- */
const publicConfig = {
  endpoint: 'https://genie-research.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_o6SJZ35O05gGB2sBkbNsS0_xs7z0PqQedXaMy3FLZOS4WZ6vkNewQXa',
};
const cloud = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
  publishableKey: publicConfig.publishableKey,
});

/* ---------- 分类定义 ---------- */
const CATS = [
  { key: 'internal',      en: 'Genie Internal',         zh: '智元 Genie 内部文章',                color: '#C9A227', desc: '论文团队来自智元 Genie 部门' },
  { key: 'agibot_g',      en: 'AGIBOT WORLD + G-Series', zh: '使用 AGIBOT WORLD 数据集及 G 系列本体', color: '#9B8AE0', desc: '同时使用数据集与 G1/G2 本体' },
  { key: 'agibot_only',   en: 'AGIBOT WORLD Only',       zh: '仅使用 AGIBOT WORLD 数据集',          color: '#4A8FD4', desc: '仅使用开源数据集，不含 G 系列真机' },
  { key: 'genie_sim',     en: 'Genie Sim',               zh: '使用 Genie Sim 仿真平台',            color: '#3FB8C4', desc: '基于 Genie Sim 仿真平台开展工作' },
  { key: 'univla',        en: 'UniVLA',                  zh: '使用 UniVLA 进行对比',               color: '#E08A3C', desc: '将 UniVLA 作为对比基线' },
  { key: 'citation_only', en: 'Citation Only',           zh: '仅引用提及',                        color: '#6D7885', desc: '仅在参考文献或正文中提及' },
  { key: 'other',         en: 'Other',                   zh: '其他引用',                          color: '#4A535E', desc: '暂未归入以上六类' },
];
const DONUT_CATS = CATS.filter(c => c.key !== 'other');
const ADMIN_PWD = '020414';

/* 展示口径：排除「未归类（other）」论文。
   当前 other 仅 2 篇 Genie Envisioner 相关，按需求不参与统计与展示，
   因此全站口径统一为 158 篇（160 - 2）。 */
const HIDDEN_CATS = ['other'];
const visiblePapers = list => (list || []).filter(p => !HIDDEN_CATS.includes(p.category));

/* 引用次数统计表：列键 → 表头日期 */
const CITE_COLS = [['c_0807', '8.1'], ['c_0901', '9.1'], ['c_1001', '10.1']];

/* 柱状图起始月份：不展示 2025 年 9 月之前的数据 */
const BAR_START = '2025-09';

let PAPERS = [];
let CITES = [];
let curCat = 'internal';
let editingId = null;

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nfmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));

function classify(team, raw) {
  const t = team || '', r = (raw || '').toLowerCase();
  if (t.includes('智元')) return 'internal';
  if (r.includes('g1') || r.includes('g2') || r.includes('g系列') || r.includes('g 系列')) return 'agibot_g';
  if (r.includes('agibot world') || r.includes('agibot-world')) return 'agibot_only';
  if (r.includes('genie sim')) return 'genie_sim';
  if (r.includes('univla')) return 'univla';
  if ((raw || '').includes('仅引用提及') || (raw || '').includes('仅提及')) return 'citation_only';
  return 'other';
}
function sortDate(s) {
  s = (s || '').trim().replace(/-/g, '/');
  const m = s.match(/^(\d{4})(?:\/(\d{1,2}))?(?:\/(\d{1,2}))?/);
  if (!m) return '';
  const y = m[1], mo = Math.min(Math.max(parseInt(m[2] || 1, 10), 1), 12), dy = Math.min(Math.max(parseInt(m[3] || 1, 10), 1), 31);
  return `${y}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`;
}
function setStatus(kind, text) {
  $('#statusDot').className = 'dot ' + kind;
  $('#statusText').textContent = text;
}
function catOf(k) { return CATS.find(c => c.key === k) || CATS[CATS.length - 1]; }

/* ---------- 数据加载与首次自动入库 ---------- */
async function fetchAll() {
  const [p, c] = await Promise.all([
    cloud.database.from('papers').select('*').order('seq', { ascending: true }).limit(2000),
    cloud.database.from('citations').select('*').order('seq', { ascending: true }).limit(200),
  ]);
  if (p.error) throw p.error;
  if (c.error) throw c.error;
  return [p.data || [], c.data || []];
}

async function seedFromBundle() {
  const [pSeed, cSeed] = await Promise.all([
    fetch('data/papers.seed.json').then(r => r.json()),
    fetch('data/citations.seed.json').then(r => r.json()),
  ]);
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  for (const batch of chunk(pSeed, 40)) {
    const { error } = await cloud.database.from('papers').insert(batch);
    if (error) throw error;
  }
  const { error } = await cloud.database.from('citations').insert(cSeed);
  if (error) throw error;
  return [pSeed.length, cSeed.length];
}

async function initData() {
  try {
    setStatus('load', '正在加载数据…');
    let [p, c] = await fetchAll();
    if (p.length === 0) {
      setStatus('load', '首次访问，正在初始化云端数据…');
      await seedFromBundle();
      [p, c] = await fetchAll();
    }
    PAPERS = visiblePapers(p); CITES = c;
    setStatus('ok', `已就绪 · ${PAPERS.length} 条记录`);
    renderAll();
  } catch (e) {
    console.error(e);
    setStatus('err', '数据加载失败');
    $('#stats').innerHTML = `<div class="stat"><div class="stat-label">DATA ERROR</div>
      <div class="stat-value" style="font-size:16px;color:var(--up)">加载失败</div>
      <div class="stat-unit">${esc(e.message || String(e))}</div></div>`;
  }
}

/* ---------- 渲染入口 ---------- */
function renderAll() { renderStats(); renderDonut(); renderBars(); renderCiteTable(); renderCatSeg(); renderDetail(); }

function renderStats() {
  const totals = CITE_COLS.map(([k]) => CITES.reduce((a, r) => a + (r[k] || 0), 0));
  const latest = Math.max.apply(null, [0].concat(totals));
  const quality = PAPERS.length;
  $('#stats').innerHTML = `
    <div class="stat"><div class="stat-label">谷歌学术引用合计</div>
      <div class="stat-value gold">${nfmt(latest)}</div></div>
    <div class="stat"><div class="stat-label">高质量论文引用数</div>
      <div class="stat-value">${nfmt(quality)}</div></div>
    <div class="stat"><div class="stat-label">收录论文总数</div>
      <div class="stat-value">${nfmt(PAPERS.length)}</div></div>
    <div class="stat"><div class="stat-label">归并分类</div>
      <div class="stat-value">${DONUT_CATS.length}<span class="stat-unit">类</span></div></div>`;
}

/* ---------- 环形图 ---------- */
function renderDonut() {
  const counts = DONUT_CATS.map(c => ({ ...c, n: PAPERS.filter(p => p.category === c.key).length }));
  const others = PAPERS.filter(p => p.category === 'other').length;
  const total = counts.reduce((a, x) => a + x.n, 0);

  const R = 60, C = 2 * Math.PI * R;
  let off = 0, segs = '';
  counts.forEach(x => {
    if (!x.n) return;
    const frac = x.n / total, len = frac * C;
    segs += `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${x.color}"
      stroke-width="18" stroke-dasharray="${(len - 1.5).toFixed(2)} ${(C - len + 1.5).toFixed(2)}"
      stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)" style="transition:stroke-dasharray .6s"><title>${esc(x.zh)}：${x.n} 篇（${(frac * 100).toFixed(1)}%）</title></circle>`;
    off += len;
  });
  $('#donutWrap').innerHTML = `
    <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="高质量论文引用分布">
      <circle r="${R}" cx="80" cy="80" fill="none" stroke="var(--surface-3)" stroke-width="18"/>
      ${segs}
      <text class="donut-center-label" x="80" y="72" text-anchor="middle">CITED PAPERS</text>
      <text class="donut-center-value" x="80" y="98" text-anchor="middle">${total}</text>
    </svg>`;

  $('#donutLegend').innerHTML = counts.map(x => `
    <div class="dl-item">
      <span class="dl-swatch" style="background:${x.color}"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.zh)}">${esc(x.zh)}</span>
      <b>${x.n}</b><span class="dl-pct">${total ? (x.n / total * 100).toFixed(1) : 0}%</span>
    </div>`).join('');

  const note = $('#donutNote');
  if (others > 0) {
    note.style.display = 'flex';
    note.innerHTML = `<span>另有</span><b>${others}</b><span>条「其他引用」未归入以上六类，已单独标注</span>`;
  } else { note.style.display = 'none'; }
}

/* ---------- 柱状图 ---------- */
function renderBars() {
  const map = {};
  PAPERS.forEach(p => {
    const m = (p.sort_date || '').slice(0, 7);
    if (!m || m < BAR_START) return; // 不展示 2025 年 9 月之前的数据
    map[m] = map[m] || { q: 0, c: 0 };
    if (p.category === 'citation_only') map[m].c++;
    else map[m].q++;
  });
  const series = Object.keys(map).sort().map(m => {
    const r = map[m];
    return { m, q: r.q, c: r.c, v: r.q + r.c };
  });
  if (!series.length) { $('#bars').innerHTML = '<div class="empty-hint">暂无可统计的日期数据</div>'; return; }

  const max = Math.max(1, ...series.map(s => s.v));
  const steps = 4;

  let grid = '';
  for (let i = 0; i <= steps; i++) {
    const y = (i / steps) * 100;
    grid += `<div class="gridline" style="bottom:${y}%"><span>${Math.round(max * (1 - y / 100))}</span></div>`;
  }
  const tip = $('#barTip');
  $('#bars').innerHTML = grid + series.map(s => `
    <div class="bar-col" data-m="${s.m}">
      <div class="bar-stack" style="height:${(s.v / max * 100).toFixed(2)}%">
        <div class="bar-seg q" style="height:${(s.q / (s.v || 1) * 100).toFixed(2)}%"></div>
        <div class="bar-seg c" style="height:${(s.c / (s.v || 1) * 100).toFixed(2)}%"></div>
      </div>
      <div class="bar-x">${s.m.slice(2).replace('-', '/')}</div>
    </div>`).join('');

  $('#bars').querySelectorAll('.bar-col').forEach(el => {
    const s = series.find(x => x.m === el.dataset.m);
    el.addEventListener('mousemove', e => {
      tip.style.display = 'block';
      tip.style.left = Math.min(e.clientX + 14, innerWidth - 180) + 'px';
      tip.style.top = (e.clientY - 12) + 'px';
      tip.innerHTML = `<b>${esc(s.m)}</b><br>非仅引用：<b style="color:var(--gold-bright)">${s.q}</b> 篇<br>仅引用提及：<b>${s.c}</b> 篇<br>合计：${s.v} 篇`;
    });
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });

  $('#barLegend').innerHTML = `
    <span class="dl-item"><span class="dl-swatch" style="background:var(--gold)"></span>非「仅引用」板块</span>
    <span class="dl-item"><span class="dl-swatch" style="background:var(--surface-4);border:1px solid var(--line-strong)"></span>仅引用提及</span>
    <span class="dl-item" style="margin-left:auto;color:var(--text-4)">${series[0].m.replace('-', '/')} 起 · 共 ${series.length} 个月 · 峰值 ${max} 篇</span>`;
}

/* ---------- 引用次数统计表 ---------- */
function renderCiteTable() {
  const body = CITES.map(r => {
    const vals = CITE_COLS.map(([k]) => r[k]);
    const last = [...vals].reverse().find(v => v != null);
    return `<tr>
      <td class="c-type">${esc(r.ctype || '—')}</td>
      <td class="c-title">${esc(r.title || '—')}</td>
      ${vals.map(v => v == null ? '<td class="na">—</td>' : `<td>${nfmt(v)}</td>`).join('')}
      <td style="color:var(--gold-bright)">${last == null ? '—' : nfmt(last)}</td>
    </tr>`;
  }).join('');
  const tot = CITE_COLS.map(([k]) => CITES.reduce((a, r) => a + (r[k] || 0), 0));
  const latest = Math.max.apply(null, tot);
  $('#citeBody').innerHTML = body + `<tr class="is-total">
    <td>总和</td><td></td>
    ${tot.map(v => v ? `<td>${nfmt(v)}</td>` : '<td class="na">—</td>').join('')}
    <td>${nfmt(latest)}</td></tr>`;
  $('#citeFootRight').textContent = `${CITES.length} 篇论文`;
}

/* ---------- 明细页 ---------- */
function renderCatSeg() {
  $('#catSeg').innerHTML = CATS.filter(c => c.key !== 'other').map(c => {
    const n = PAPERS.filter(p => p.category === c.key).length;
    return `<button class="seg-btn${c.key === curCat ? ' is-active' : ''}" data-cat="${c.key}">
      ${esc(c.en)} <span style="color:var(--text-4);margin-left:3px">${n}</span></button>`;
  }).join('');
  $('#catSeg').querySelectorAll('.seg-btn').forEach(b => {
    b.onclick = () => { curCat = b.dataset.cat; renderCatSeg(); renderDetail(); };
  });
}

function teamChips(team) {
  if (!team) return '<span class="pc-empty">—</span>';
  return team.split(/[、,，;；\n]/).map(s => s.trim()).filter(Boolean)
    .map(s => `<span class="team-chip${s.includes('智元') ? ' self' : ''}">${esc(s)}</span>`)
    .join('');
}

function linkBtn(url) {
  if (!url) return '<span class="pc-empty">—</span>';
  const m = url.match(/https?:\/\/[^\s，,；;]+/);
  const href = m ? m[0] : url;
  return `<a class="pc-link" href="${esc(href)}" target="_blank" rel="noopener">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>
    跳转原文</a>`;
}

function renderDetail() {
  const c = catOf(curCat);
  $('#catZh').textContent = c.zh;
  const list = PAPERS.filter(p => p.category === curCat)
    .sort((a, b) => (b.sort_date || '').localeCompare(a.sort_date || ''));
  $('#catCount').textContent = `${list.length} 篇 · ${c.desc}`;
  $('#detailFootRight').textContent = `${list.length} / ${PAPERS.length} 条`;

  const body = $('#detailBody');
  if (curCat === 'citation_only') {
    const rows = list.map((p, i) => `
      <div class="co-item">
        <span class="pc-idx" style="min-width:20px">${i + 1}</span>
        <span class="co-name" title="${esc(p.title)}">${esc(p.title || '（未填写标题）')}</span>
        ${p.venue ? `<a class="co-link" href="${esc((p.venue.match(/https?:\/\/[^\s，,；;]+/) || [p.venue])[0])}" target="_blank" rel="noopener">链接</a>` : ''}
      </div>`).join('');
    const others = PAPERS.filter(p => p.category === 'other');
    const otherHtml = others.length ? `
      <div class="co-group-label">其他引用 · 未归类 ${others.length} 条</div>
      ${others.map(p => `
        <div class="co-item">
          <span class="co-name" title="${esc(p.title)}">${esc(p.title || '（未填写标题）')}</span>
          ${p.venue ? `<a class="co-link" href="${esc((p.venue.match(/https?:\/\/[^\s，,；;]+/) || [p.venue])[0])}" target="_blank" rel="noopener">链接</a>` : ''}
        </div>`).join('')}` : '';
    body.innerHTML = `<div class="co-grid">${rows}${otherHtml}</div>`;
    return;
  }

  if (!list.length) {
    body.innerHTML = '<div class="empty-hint" style="padding:40px 0">该板块暂无论文</div>';
    return;
  }
  body.innerHTML = `<div class="paper-list">` + list.map((p, i) => `
    <div class="paper-card">
      <div class="pc-top">
        <span class="pc-idx">${String(i + 1).padStart(2, '0')}</span>
        <div class="pc-main">
          <div class="pc-title">${esc(p.title || '（未填写标题）')}</div>
          <div class="pc-meta">
            ${p.pub_date ? `<span class="pc-date">${esc(p.pub_date)}</span>` : ''}
            <span class="team-chips">${teamChips(p.team)}</span>
            <span style="margin-left:auto">${linkBtn(p.venue)}</span>
          </div>
          <div class="pc-body">
            <div>
              <div class="pc-field-label">核心研究内容</div>
              <div class="pc-text">${p.summary ? esc(p.summary) : '<span class="pc-empty">暂无摘要记录</span>'}</div>
            </div>
            <div>
              <div class="pc-field-label">智元产品关联</div>
              <div class="pc-rel">${p.agibot_rel ? esc(p.agibot_rel) : `<span class="pc-empty">${esc(p.raw_category || '暂无关联说明')}</span>`}</div>
            </div>
          </div>
        </div>
      </div>
    </div>`).join('') + `</div>`;
}

/* ---------- 视图切换 ---------- */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
  document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
  if (name === 'admin') renderAdmin();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('#tabs .tab').forEach(t => t.onclick = () => showView(t.dataset.view));

/* ---------- 后台 ---------- */
function isAdmin() { return sessionStorage.getItem('genieAdmin') === '1'; }
function renderAdmin() {
  const panel = $('#adminPanel');
  if (!isAdmin()) {
    panel.innerHTML = `<div class="pw-box">
      <div style="font-size:11.5px;color:var(--text-3);margin-bottom:16px">请输入管理密码以进入后台</div>
      <input type="password" id="pwInput2" autocomplete="off" placeholder="••••••">
      <div class="pw-err" id="pwErr2"></div>
      <button class="btn-primary" id="pwOk2" style="margin-top:6px">进入后台</button></div>`;
    const go = () => {
      const v = $('#pwInput2').value;
      if (v === ADMIN_PWD) { sessionStorage.setItem('genieAdmin', '1'); renderAdmin(); }
      else $('#pwErr2').textContent = '密码错误，请重试';
    };
    $('#pwOk2').onclick = go;
    $('#pwInput2').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    return;
  }

  const rows = PAPERS.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)).map(p => `
    <tr data-id="${p.id}">
      <td style="width:44px;color:var(--text-4)">${p.seq ?? '—'}</td>
      <td style="width:118px"><span style="color:${catOf(p.category).color}">${esc(catOf(p.category).en)}</span></td>
      <td style="width:auto"><div style="color:var(--text-1);font-weight:500">${esc(p.title || '（无标题）')}</div>
        <div style="font-size:10.5px;color:var(--text-4);margin-top:3px">${esc(p.team || '')}</div></td>
      <td style="width:78px">${esc(p.pub_date || '—')}</td>
      <td style="width:90px">${esc(p.source || 'seed')}</td>
      <td class="a-act" style="width:118px">
        <button class="btn-mini" data-act="edit" data-id="${p.id}">编辑</button>
        <button class="btn-mini danger" data-act="del" data-id="${p.id}">删除</button></td>
    </tr>`).join('');

  panel.innerHTML = `
    <div class="admin-toolbar">
      <input id="adminSearch" placeholder="搜索标题 / 团队 / 链接" style="flex:1;min-width:180px;
        font-family:inherit;font-size:11.5px;color:var(--text-1);background:var(--surface-2);
        border:1px solid var(--line);border-radius:var(--radius-sm);padding:6px 11px;outline:none">
      <button class="btn-primary" id="adminAdd">新增论文</button>
      <span style="font-size:11px;color:var(--text-4)">共 ${PAPERS.length} 条</span>
    </div>
    <div style="max-height:56vh;overflow:auto">
      <table class="admin-table">
        <colgroup><col style="width:44px"><col style="width:118px"><col><col style="width:78px"><col style="width:90px"><col style="width:118px"></colgroup>
        <thead><tr><th>序号</th><th>分类</th><th>标题 / 团队</th><th>日期</th><th>来源</th><th style="text-align:right">操作</th></tr></thead>
        <tbody id="adminBody">${rows}</tbody>
      </table>
    </div>`;

  $('#adminAdd').onclick = () => openEdit(null);
  $('#adminSearch').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#adminBody tr').forEach(tr => {
      tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  };
  document.querySelectorAll('#adminBody [data-act]').forEach(b => {
    b.onclick = () => {
      const id = Number(b.dataset.id);
      if (b.dataset.act === 'edit') openEdit(id);
      else delPaper(id);
    };
  });
}

function openEdit(id) {
  editingId = id;
  // 只提供展示口径内的分类，避免新增出「未归类」记录后从列表中消失
  $('#editCat').innerHTML = DONUT_CATS.map(c => `<option value="${c.key}">${esc(c.en)} · ${esc(c.zh)}</option>`).join('');
  const p = id == null ? {} : PAPERS.find(x => x.id === id) || {};
  ['title', 'raw_category', 'team', 'pub_date', 'venue', 'summary', 'agibot_rel', 'category'].forEach(k => {
    const el = $('#editForm').elements[k];
    if (el) el.value = p[k] || '';
  });
  $('#editTitle').textContent = id == null ? '新增论文' : '编辑论文';
  $('#editModal').classList.add('is-open');
}

$('#editForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  const payload = {
    title: f.title.value.trim(),
    category: f.category.value,
    raw_category: f.raw_category.value.trim(),
    team: f.team.value.trim(),
    pub_date: f.pub_date.value.trim(),
    sort_date: sortDate(f.pub_date.value),
    venue: f.venue.value.trim(),
    summary: f.summary.value.trim(),
    agibot_rel: f.agibot_rel.value.trim(),
  };
  if (!payload.title) return alert('论文标题不能为空');
  try {
    if (editingId == null) {
      const maxSeq = PAPERS.reduce((a, p) => Math.max(a, p.seq || 0), 0);
      const { error } = await cloud.database.from('papers').insert({ ...payload, seq: maxSeq + 1, source: 'manual' });
      if (error) throw error;
    } else {
      const { data, error } = await cloud.database.from('papers').update(payload).eq('id', editingId).select();
      if (error) throw error;
      if (!data || !data.length) throw new Error('更新未生效，请检查权限');
    }
    $('#editModal').classList.remove('is-open');
    await refresh();
  } catch (err) { alert('保存失败：' + (err.message || err)); }
};

async function delPaper(id) {
  const p = PAPERS.find(x => x.id === id);
  if (!confirm(`确认删除该条记录？\n\n${p ? p.title : ''}\n\n此操作不可恢复。`)) return;
  try {
    const { data, error } = await cloud.database.from('papers').delete().eq('id', id).select();
    if (error) throw error;
    if (!data || !data.length) throw new Error('删除未生效');
    await refresh();
  } catch (err) { alert('删除失败：' + (err.message || err)); }
}

async function refresh() {
  const [p, c] = await fetchAll();
  PAPERS = visiblePapers(p); CITES = c;
  renderAll();
  if ($('#view-admin').classList.contains('is-active')) renderAdmin();
  setStatus('ok', `已就绪 · ${PAPERS.length} 条记录`);
}

/* ---------- 密码弹窗 ---------- */
$('#adminLink').onclick = e => {
  e.preventDefault();
  if (isAdmin()) { showView('admin'); return; }
  $('#pwModal').classList.add('is-open');
  setTimeout(() => $('#pwInput').focus(), 60);
};
function tryPw() {
  if ($('#pwInput').value === ADMIN_PWD) {
    sessionStorage.setItem('genieAdmin', '1');
    $('#pwModal').classList.remove('is-open');
    $('#pwErr').textContent = '';
    $('#pwInput').value = '';
    showView('admin');
  } else $('#pwErr').textContent = '密码错误，请重试';
}
$('#pwOk').onclick = tryPw;
$('#pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') tryPw(); });
document.querySelectorAll('[data-close]').forEach(b => {
  b.onclick = () => $('#' + b.dataset.close).classList.remove('is-open');
});

/* ---------- 悬浮搜索 Agent ---------- */
let llmModel = null;
const AGENT_WELCOME = `你好，我是智元 Genie 科研合作的论文解析助手。

把一篇论文的<b>链接</b>发给我（arXiv / DOI 链接均可），我会自动解析并提取：
· 论文标题
· 论文团队（高校 / 团队）
· 链接
· 核心内容（约 100 字）
· 智元产品关联情况

元数据实时取自 OpenAlex、DataCite、Crossref 等公开学术库，解析完成后<b>自动录入数据库</b>，并可在后台继续编辑。
如果链接抓取失败，也可以直接把论文标题与摘要粘贴给我。`;

function agentMsg(html, who = 'bot') {
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.innerHTML = html;
  $('#agentBody').appendChild(d);
  $('#agentBody').scrollTop = $('#agentBody').scrollHeight;
  return d;
}

/* ---------------------------------------------------------------
 * 论文元数据多源解析
 * 全部为「浏览器可直连 + 无需 API Key + 带 CORS」的公开学术数据源：
 *   1. OpenAlex   api.openalex.org        —— 覆盖最广，含作者机构与摘要
 *   2. DataCite   api.datacite.org        —— arXiv 全量 DOI 注册（含 2017 等老论文）
 *   3. Crossref   api.crossref.org        —— DOI 兜底（IEEE / ACM / Springer 等）
 * 优先级：OpenAlex(有机构) → DataCite(arXiv 兜底) → Crossref(DOI 兜底)
 * ------------------------------------------------------------- */
const MAILTO = 'research@agibot.com';

const uniq = a => Array.from(new Set(a.map(s => String(s).trim()).filter(Boolean)));
const clean = s => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function jfetch(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .finally(() => clearTimeout(t));
}

/* OpenAlex 摘要以「倒排索引」存储，需还原成句子 */
function invertAbstract(idx) {
  if (!idx || typeof idx !== 'object') return '';
  const arr = [];
  for (const [w, ps] of Object.entries(idx)) {
    if (!Array.isArray(ps)) continue;
    for (const p of ps) arr[p] = w;
  }
  return arr.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function fromOpenAlex(w, fallbackLink) {
  if (!w || w.error || !w.title) return null;
  const authors = [], insts = [], raw = [];
  for (const a of (w.authorships || [])) {
    const n = a.author && a.author.display_name;
    if (n) authors.push(n);
    for (const i of (a.institutions || [])) if (i.display_name) insts.push(i.display_name);
    for (const r of (a.raw_affiliation_strings || [])) if (r) raw.push(r);
  }
  const loc = w.primary_location || {};
  const venue = (loc.source && loc.source.display_name) || '';
  return {
    source: 'OpenAlex',
    title: clean(w.title),
    authors,
    institutions: uniq(insts),
    raw_affiliations: uniq(raw),
    abstract: invertAbstract(w.abstract_inverted_index),
    published: w.publication_date || (w.publication_year ? String(w.publication_year) : ''),
    link: w.doi || fallbackLink,
    venue,
    concepts: (w.concepts || []).filter(c => (c.score || 0) > 0.35).slice(0, 6).map(c => c.display_name),
  };
}

function fromDataCite(d, fallbackLink) {
  const a = d && d.data && d.data.attributes;
  if (!a) return null;
  const titles = a.titles || [];
  const t = titles.find(x => !x.titleType || x.titleType === 'Main') || titles[0];
  if (!t || !t.title) return null;
  const authors = [], insts = [];
  for (const c of (a.creators || [])) {
    if (c.name) authors.push(c.name);
    for (const af of (c.affiliation || [])) {
      const n = typeof af === 'string' ? af : (af && af.name);
      if (n) insts.push(n);
    }
  }
  const abs = (a.descriptions || []).find(x => x.descriptionType === 'Abstract');
  const dates = a.dates || [];
  const sub = dates.find(x => x.dateType === 'Submitted') || dates[0] || {};
  return {
    source: 'DataCite',
    title: clean(t.title),
    authors,
    institutions: uniq(insts),
    raw_affiliations: [],
    abstract: abs ? clean(abs.description) : '',
    published: (sub.date || '').slice(0, 10) || (a.publicationYear ? String(a.publicationYear) : ''),
    link: a.url || fallbackLink,
    venue: a.publisher || '',
    concepts: (a.subjects || []).map(s => s.subject).filter(s => s && !/^FOS:/.test(s)).slice(0, 6),
  };
}

function fromCrossref(c, fallbackLink) {
  const m = c && c.message;
  if (!m || !(m.title && m.title[0])) return null;
  const authors = [], insts = [];
  for (const a of (m.author || [])) {
    const n = [a.given, a.family].filter(Boolean).join(' ').trim();
    if (n) authors.push(n);
    for (const af of (a.affiliation || [])) if (af && af.name) insts.push(af.name);
  }
  const dp = m['published-print'] || m['published-online'] || m.issued || m.created || {};
  const parts = (dp['date-parts'] || [[]])[0] || [];
  return {
    source: 'Crossref',
    title: clean(m.title[0]),
    authors,
    institutions: uniq(insts),
    raw_affiliations: [],
    abstract: m.abstract ? clean(m.abstract) : '',
    published: parts.filter(x => x != null).join('-'),
    link: m.URL || (m.DOI ? 'https://doi.org/' + m.DOI : fallbackLink),
    venue: (m['container-title'] || [])[0] || m.publisher || '',
    concepts: (m.subject || []).slice(0, 6),
  };
}

/* 从任意输入中解析出可检索的论文标识 */
function parsePaperRef(raw) {
  const url = String(raw || '').trim();
  const ref = { input: url, link: /^https?:\/\//i.test(url) ? url : '' };
  let m;
  // 1) arXiv（abs / pdf / html 链接，或 "arXiv:2401.12345"，或直接粘贴编号）
  m = url.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?/i)
    || url.match(/\barxiv[:\s/]+(\d{4}\.\d{4,5})\b/i)
    || url.match(/^(\d{4}\.\d{4,5})(?:v\d+)?$/);
  if (m) { ref.arxiv = m[1]; ref.link = 'https://arxiv.org/abs/' + m[1]; return ref; }
  // 2) OpenAlex Work ID
  m = url.match(/openalex\.org\/(W\d+)/i) || url.match(/^(W\d+)$/i);
  if (m) { ref.openalex = m[1]; return ref; }
  // 3) DOI
  m = url.match(/(?:doi\.org\/|dx\.doi\.org\/)?\b(10\.\d{4,9}\/[^\s"'<>，,；;\]）)]+)/i);
  if (m) { ref.doi = m[1].replace(/[.,)\]]+$/, ''); return ref; }
  // 4) 其它链接 / 纯文本 → 提取关键词走 OpenAlex 全文检索
  ref.search = slugKeywords(url);
  return ref;
}

function slugKeywords(s) {
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return s.replace(/\s+/g, ' ').slice(0, 200); // 直接当标题检索
  try {
    const u = new URL(s);
    const q = u.searchParams.get('title') || u.searchParams.get('q') || '';
    if (q && q.length > 8) return q.slice(0, 200);
    const seg = (u.pathname.split('/').filter(Boolean).pop() || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    const words = seg.split(/[-_+]+/).filter(w => w.length > 2 && !/^[0-9a-f]{8,}$/i.test(w));
    return words.length >= 3 ? words.join(' ') : '';
  } catch (e) { return ''; }
}

/* 富化：arXiv / 会议预印本记录常常没有作者机构字段。
   用标题去 OpenAlex 检索「同一篇论文的正式发表版本」，把机构与单位原文补回来，
   这样「论文团队来自哪个高校」就不必依赖模型记忆去猜。 */
const normTitle = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
async function enrichInstitutions(meta) {
  if (!meta || meta._miss || !meta.title || meta.title.length < 12) return meta;
  if ((meta.institutions || []).length > 0) return meta;
  try {
    const d = await jfetch(`https://api.openalex.org/works?search=${encodeURIComponent(meta.title)}&per-page=5&mailto=${encodeURIComponent(MAILTO)}`, 6000);
    const key = normTitle(meta.title);
    for (const w of (d.results || [])) {
      const cand = fromOpenAlex(w, meta.link);
      if (!cand) continue;
      const ck = normTitle(cand.title);
      const similar = ck && (ck === key || ck.startsWith(key.slice(0, 40)) || key.startsWith(ck.slice(0, 40)));
      if (!similar) continue;
      if ((cand.institutions || []).length) {
        meta.institutions = cand.institutions;
        meta.raw_affiliations = cand.raw_affiliations || [];
        if (!meta.venue && cand.venue) meta.venue = cand.venue;
        if (!meta.abstract && cand.abstract) meta.abstract = cand.abstract;
        meta.enriched = true;
        break;
      }
    }
  } catch (e) { /* 富化失败不影响主流程 */ }
  return meta;
}

/* 按优先级依次尝试各数据源 */
async function resolveMeta(ref) {
  const q = encodeURIComponent(MAILTO);
  const tries = [];
  if (ref.arxiv) {
    tries.push(['OpenAlex', () => jfetch(`https://api.openalex.org/works/doi:10.48550/arxiv.${ref.arxiv}?mailto=${q}`).then(d => fromOpenAlex(d, ref.link))]);
    tries.push(['DataCite', () => jfetch(`https://api.datacite.org/dois/10.48550/arxiv.${ref.arxiv}`).then(d => fromDataCite(d, ref.link))]);
  }
  if (ref.doi) {
    tries.push(['OpenAlex', () => jfetch(`https://api.openalex.org/works/doi:${ref.doi.split('/').map(encodeURIComponent).join('/')}?mailto=${q}`).then(d => fromOpenAlex(d, ref.link))]);
    tries.push(['Crossref', () => jfetch(`https://api.crossref.org/works/${encodeURIComponent(ref.doi)}`).then(d => fromCrossref(d, ref.link))]);
    tries.push(['DataCite', () => jfetch(`https://api.datacite.org/dois/${ref.doi}`).then(d => fromDataCite(d, ref.link))]);
  }
  if (ref.openalex) {
    tries.push(['OpenAlex', () => jfetch(`https://api.openalex.org/works/${ref.openalex}?mailto=${q}`).then(d => fromOpenAlex(d, ref.link))]);
  }
  if (ref.search) {
    tries.push(['OpenAlex 检索', () => jfetch(`https://api.openalex.org/works?search=${encodeURIComponent(ref.search)}&per-page=1&mailto=${q}`).then(d => fromOpenAlex((d.results || [])[0], ref.link))]);
  }
  const errs = [];
  const deadline = Date.now() + 18000; // 整体检索预算，避免长时间等待
  for (const [name, fn] of tries) {
    if (Date.now() > deadline) { errs.push('检索超时，已跳过 ' + name); break; }
    try {
      const m = await fn();
      if (m && m.title) return await enrichInstitutions(m);
      errs.push(name + ':无匹配纪录');
    } catch (e) { errs.push(name + ':' + ((e && e.message) || e)); }
  }
  return { _miss: true, errs };
}

/* 模型选择策略：
   cloud.llm.models.list() 的首位是 "auto"，实测会路由到推理型模型，
   单次解析需 120s 以上，交互上不可接受。因此按「速度 + 中文能力」显式优先排序，
   逐个回退；全部不可用时再退回列表里第一个非推理模型。 */
const MODEL_PREFERENCE = [
  'deepseek-v4.1-flash',
  'glm-5.3-flash',
  'deepseek-v4-flash',
  'kimi-k2.5',
  'glm-4.6',
  'hunyuan-chat',
];
async function ensureModel() {
  if (llmModel) return llmModel;
  const models = await cloud.llm.models.list();
  const usable = models.filter(m => m.disabled !== true && m.enabled !== false);
  if (!usable.length) throw new Error('当前应用未配置可用的大模型');
  llmModel = MODEL_PREFERENCE.map(id => usable.find(m => m.id === id)).find(Boolean)
    || usable.find(m => !/thinking|reason|\bpro\b|^o[13]/i.test(m.id))
    || usable[0];
  return llmModel;
}

const AGENT_SYSTEM = `你是智元机器人「Genie 科研合作」数据库的论文解析助手。根据给定的论文信息，抽取字段并只输出一个 JSON 对象，不要输出任何其他文字或代码块标记。
字段定义：
- title: 论文标题（严格保留原文，不改写、不翻译）
- team: 论文团队，多个用「、」连接，格式如「智元机器人、香港大学」；尽量指出高校与团队名
- pub_date: 发表日期，格式 YYYY/M 或 YYYY/M/D，未知则空字符串
- venue: 发表信息，若有 DOI/会议名给出，否则填原文链接
- summary: 文章核心研究内容，中文，约 100 字（严格控制在 90–115 字），客观概括方法与结论，不要分点、不要换行
- agibot_rel: 智元产品关联情况，中文，说明该论文与 AGIBOT WORLD 数据集 / Genie Sim 仿真平台 / G1、G2 本体 / UniVLA 的关系；若无关联写「暂无直接关联」
- category: 从以下枚举中选最贴切的一个：internal, agibot_g, agibot_only, genie_sim, univla, citation_only

team 字段的判定规则（重要，按顺序执行）：
1. 若用户消息中提供了「作者机构」或「作者单位原文片段」，必须优先依据该字段归纳出高校 / 研究机构 / 企业团队名，不得凭记忆擅改。
2. 若机构字段为空，则结合作者姓名、主题分类与发表载体推断主要团队；例如作者含 AgiBot-World-Contributors 应识别为「智元机器人」，作者含 Google DeepMind 员工应识别为「Google DeepMind」。
3. 只写你有把握的单位，最多 4 个；确实无法判断时填「未标注」，严禁编造。
4. 不要把作者个人姓名当作团队名填写。

严格 JSON，所有字段必填，字符串内不要出现未转义引号。`;

function safeJsonParse(s) {
  s = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('模型未返回有效 JSON');
  return JSON.parse(s.slice(a, b + 1));
}

/* 把抓取到的元数据整理成给大模型的用户消息 */
function metaToPrompt(meta, ref) {
  if (!meta || meta._miss) {
    const why = (meta && meta.errs && meta.errs.length) ? `（公开库检索结果：${meta.errs.join('；')}）` : '';
    return `用户输入：${ref.input}\n${why}\n未能从公开学术数据库检索到该论文的元数据。请基于你自己的知识解析；若无法确认标题，title 请留空，绝对不要编造论文标题与作者。`;
  }
  const L = [`数据来源：${meta.source}（公开学术数据库）`, `标题：${meta.title}`];
  if (meta.authors && meta.authors.length) {
    L.push(`作者（共 ${meta.authors.length} 位）：${meta.authors.slice(0, 30).join('、')}${meta.authors.length > 30 ? ' 等' : ''}`);
  }
  if (meta.institutions && meta.institutions.length) L.push(`作者机构：${meta.institutions.join(' | ')}`);
  if (meta.raw_affiliations && meta.raw_affiliations.length) L.push(`作者单位原文片段：${meta.raw_affiliations.slice(0, 8).join(' | ')}`);
  if (meta.published) L.push(`发表日期：${meta.published}`);
  if (meta.venue) L.push(`发表载体：${meta.venue}`);
  if (meta.concepts && meta.concepts.length) L.push(`主题分类：${meta.concepts.join('、')}`);
  L.push(`原文链接：${meta.link}`);
  if (meta.abstract) L.push(`摘要：${meta.abstract.slice(0, 2200)}`);
  else L.push('摘要：（该数据源未提供摘要，请依据标题与主题分类概括，不要编造具体实验数字）');
  return `论文元数据如下，请勿改动标题原文：\n` + L.join('\n');
}

async function runAgent(input) {
  const ref = parsePaperRef(input);

  agentMsg(`<span style="color:var(--text-3)">正在检索论文元数据…</span>`, 'bot');
  const meta = await resolveMeta(ref);
  const hit = meta && !meta._miss;

  const srcNote = hit
    ? `已从 ${meta.source} 获取论文元数据（${meta.authors.length} 位作者${meta.abstract ? ' · 含摘要' : ''}${(meta.institutions || []).length ? ` · ${meta.institutions.length} 家机构` : ''}${meta.enriched ? ' · 已补全发表版机构' : ''}），正在解析…`
    : `公开学术库未命中（${(meta.errs || []).join('；').slice(0, 140)}），改用模型知识解析…`;
  agentMsg(`<span style="color:var(--text-3)">${esc(srcNote)}</span>`, 'bot');

  const userPart = metaToPrompt(meta, ref);
  const model = await ensureModel();
  let out = '';
  for await (const chunk of cloud.llm.chat.completions.create({
    model: model.id,
    messages: [{ role: 'system', content: AGENT_SYSTEM }, { role: 'user', content: userPart }],
    stream: true,
    temperature: 0.2,
  })) {
    const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
    if (d && d.content) out += d.content;
  }

  let j;
  try { j = safeJsonParse(out); } catch (e) {
    agentMsg('解析失败：模型返回内容无法解析，请重试或改用「标题 + 摘要」方式输入。', 'bot');
    return;
  }
  if (!j.title || !String(j.title).trim()) {
    agentMsg('未能确定这篇论文的标题，为避免污染数据库没有入库。<br>建议粘贴 arXiv / DOI 链接，或直接把论文标题发给我。', 'bot');
    return;
  }

  const title = String(j.title).trim();
  const dup = PAPERS.find(p => (p.title || '').trim().toLowerCase() === title.toLowerCase());
  const resolvedLink = (hit && meta.link) || (/^https?:\/\//i.test(ref.input) ? ref.input : '');

  const rec = {
    seq: PAPERS.reduce((a, p) => Math.max(a, p.seq || 0), 0) + 1,
    category: j.category && CATS.some(c => c.key === j.category) ? j.category : 'citation_only',
    raw_category: 'Agent 解析 · ' + (j.category || 'unknown') + (hit ? ' · ' + meta.source : ' · 模型知识'),
    title,
    team: j.team || '',
    pub_date: j.pub_date || '',
    sort_date: sortDate(j.pub_date || (hit ? meta.published : '')),
    venue: resolvedLink || j.venue || ref.input,
    summary: j.summary || '',
    agibot_rel: j.agibot_rel || '',
    source: 'agent',
  };

  if (dup) {
    agentMsg(`<b>该论文已存在于数据库中</b>（第 ${dup.seq} 号，分类：${esc(catOf(dup.category).en)}），未重复入库。
      <span class="m-label">论文标题</span>${esc(title)}
      <span class="m-label">论文团队</span>${esc(dup.team || rec.team || '—')}`, 'bot');
    return;
  }

  try {
    const { error } = await cloud.database.from('papers').insert(rec);
    if (error) throw error;
    await refresh();
  } catch (e) {
    agentMsg(`<b>已解析，但入库失败</b>：${esc(e.message || String(e))}<br>以下为解析结果，可手动录入后台。
      <div class="m-label">论文标题</div>${esc(rec.title)}
      <div class="m-label">论文团队</div>${esc(rec.team || '—')}
      <div class="m-label">链接</div>${esc(rec.venue || '—')}
      <div class="m-label">核心内容</div>${esc(rec.summary || '—')}
      <div class="m-label">智元产品关联</div>${esc(rec.agibot_rel || '—')}`, 'bot');
    return;
  }

  const cat = catOf(rec.category);
  agentMsg(`<b>解析完成，已录入数据库</b>（分类：${esc(cat.en)} · ${esc(cat.zh)}）
    <span class="m-label">论文标题</span>${esc(rec.title)}
    <span class="m-label">论文团队</span>${esc(rec.team || '—')}
    <span class="m-label">发表日期</span>${esc(rec.pub_date || '—')}
    <span class="m-label">链接</span>${rec.venue ? `<a href="${esc(rec.venue)}" target="_blank" rel="noopener">打开原文</a>` : '—'}
    <span class="m-label">核心内容</span>${esc(rec.summary || '—')}
    <span class="m-label">智元产品关联</span>${esc(rec.agibot_rel || '—')}
    <span class="m-label">数据来源</span>${hit ? esc(meta.source + ' 实时抓取') : '模型知识推断'}`, 'bot');
}

$('#agentFab').onclick = () => {
  const p = $('#agentPanel'), f = $('#agentFab');
  const open = !p.classList.contains('is-open');
  p.classList.toggle('is-open', open);
  f.classList.toggle('is-open', open);
  if (open && !$('#agentBody').children.length) agentMsg(AGENT_WELCOME.replace(/\n/g, '<br>'));
  if (open) setTimeout(() => $('#agentInput').focus(), 80);
};
async function agentSubmit() {
  const inp = $('#agentInput');
  const v = inp.value.trim();
  if (!v) return;
  inp.value = '';
  agentMsg(esc(v), 'user');
  const btn = $('#agentSend');
  btn.disabled = true;
  try { await runAgent(v); }
  catch (e) {
    const m = (e && e.error && e.error.message) || e.message || String(e);
    agentMsg('出错了：' + esc(m), 'bot');
  } finally { btn.disabled = false; }
}
$('#agentSend').onclick = agentSubmit;
$('#agentInput').addEventListener('keydown', e => { if (e.key === 'Enter') agentSubmit(); });

/* ---------- 启动 ---------- */
initData();

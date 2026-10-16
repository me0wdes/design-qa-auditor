// Design QA: автоматическая проверка открытой страницы на текущей ширине окна. Только чтение.
// Использование: весь текст файла передать в javascript_tool (последнее выражение возвращает отчёт).
// Прогонять на каждой контрольной ширине после resize_window. Опции: window.__QA_ROOT = '#app' сузит область.
(() => {
  const LIMIT = 12;
  const root = document.querySelector(window.__QA_ROOT || 'body') || document.body;
  const vw = document.documentElement.clientWidth;
  const out = {};
  const add = (key, el, extra) => {
    const b = out[key] || (out[key] = { count: 0, examples: [] });
    b.count++;
    if (b.examples.length < LIMIT) b.examples.push({ sel: sel(el), ...(extra || {}) });
  };
  const sel = el => {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(s + '#' + n.id); break; }
      const name = n.dataset && (n.dataset.name || n.dataset.screen);
      if (name) s += `[data-name="${name}"]`;
      else if (typeof n.className === 'string' && n.className.trim()) s += '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.');
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const visible = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0; };
  const short = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const all = [...root.querySelectorAll('*')].filter(el => !el.closest('svg') || el.tagName === 'svg');

  // 1. Горизонтальное переполнение
  if (document.documentElement.scrollWidth > vw + 1) add('page-horizontal-scroll', document.documentElement, { scrollWidth: document.documentElement.scrollWidth, vw });
  for (const el of all) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') { clipped = true; break; } }
      if (!clipped) add('element-past-viewport', el, { right: Math.round(r.right), vw });
    }
  }

  // 2. Обрезанный текст: контейнер с overflow, где содержимое больше рамки
  for (const el of all) {
    if (!visible(el) || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    const clipsX = cs.overflowX !== 'visible', clipsY = cs.overflowY !== 'visible';
    const scrollable = /auto|scroll/.test(cs.overflowX + cs.overflowY);
    if (scrollable) continue;
    if ((clipsY && el.scrollHeight > el.clientHeight + 2) || (clipsX && el.scrollWidth > el.clientWidth + 2))
      add(cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' ? 'text-truncated-intentional' : 'text-clipped', el, { text: short(el) });
  }

  // 3. Интерактивные элементы: тап-зоны и доступные имена
  const interactive = [...root.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=switch], [tabindex]:not([tabindex="-1"]), [onclick]')].filter(visible);
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) add('tap-target-below-24px', el, { w: Math.round(r.width), h: Math.round(r.height) });
    else if (r.width < 44 || r.height < 44) add('tap-target-below-44px', el, { w: Math.round(r.width), h: Math.round(r.height) });
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.value || el.placeholder || [...el.querySelectorAll('img[alt], svg title')].map(i => i.alt || i.textContent).join(' ') || '').trim();
    const labelled = el.getAttribute('aria-labelledby') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    if (!name && !labelled) add('no-accessible-name', el, { tag: el.tagName.toLowerCase() });
  }
  // Кликабельные на вид, но не интерактивные для клавиатуры
  for (const el of all) {
    if (!visible(el) || interactive.includes(el) || el.closest('a, button, [role=button]')) continue;
    if (getComputedStyle(el).cursor === 'pointer' && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== 'pointer'))
      add('pointer-without-keyboard-access', el, { text: short(el) });
  }
  for (const img of root.querySelectorAll('img')) if (visible(img) && !img.hasAttribute('alt')) add('img-without-alt', img, { src: img.currentSrc.split('/').pop() });

  // 4. Контраст текста (WCAG AA): цвет против первого непрозрачного фона предков
  const rgba = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = el => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return null; // градиент или картинка: проверять глазами
      const c = rgba(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    return layers.reduceRight((acc, c) => blend(c, acc), { r: 255, g: 255, b: 255, a: 1 });
  };
  const seen = new Set();
  for (const el of all) {
    if (!visible(el) || seen.has(el)) continue;
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!ownText) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const fg = rgba(cs.color), bg = bgOf(el);
    if (!fg || !bg) { if (fg && !bg) add('contrast-unknown-bg-image', el, { text: short(el) }); continue; }
    const f = blend(fg, bg), L1 = lum(f), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize), large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) add('contrast-below-AA', el, { ratio: +ratio.toFixed(2), need: large ? 3 : 4.5, text: short(el) });
  }

  // 5. Фокус: правила, гасящие outline без замены
  const killers = [];
  const hex = {};
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = list => { for (const r of list) {
      if (r.cssRules) walk(r.cssRules);
      if (!r.style) continue;
      if (/:focus(?!-within)/.test(r.selectorText || '') && (r.style.outlineStyle === 'none' || /^0(px)?$/.test(r.style.outlineWidth)) && !r.style.boxShadow) killers.push(r.selectorText);
      if (/^:root|^html$/.test(r.selectorText || '')) continue;
      for (const prop of r.style) { if (prop.startsWith('--')) continue; const v = r.style.getPropertyValue(prop); if (/var\(/.test(v)) continue; for (const m of v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/gi) || []) hex[m.toLowerCase()] = (hex[m.toLowerCase()] || 0) + 1; }
    } };
    walk(rules);
  }
  if (killers.length) out['focus-outline-removed'] = { count: killers.length, examples: killers.slice(0, LIMIT) };
  const hardcoded = Object.entries(hex).sort((a, b) => b[1] - a[1]);
  if (hardcoded.length) out['css-hardcoded-colors'] = { count: hardcoded.length, examples: hardcoded.slice(0, 15) };

  // 6. Текст: символы вместо иконок и русская типографика
  const GLYPH = /^[+\-−–—→←↑↓›‹»«✓✔✕✖×✗]$/;
  const TYPO = [
    ['straight-quotes', /"[^"]*"/],
    ['spaced-hyphen-as-dash', / - /],
    ['no-nbsp-before-unit', /\d (₽|%|руб|мин|ч|дн|ГБ|МБ|шт)/],
    ['no-nbsp-after-short-word', /(^|[\s(«])(в|во|и|к|ко|с|со|у|о|об|а|на|по|за|из|от|до|не|ни|но|для|при|без) (?=\S)/i],
    ['ungrouped-thousands', /(^|[^\d.,])\d{5,}(?![\d.,])/, /[№#]\s?\d|\+\d|\d{2}:\d{2}/], // третий элемент: когда не считать (номера, телефоны, время)
    ['triple-dot', /\.\.\./],
  ];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t; (t = walker.nextNode());) {
    const el = t.parentElement, s = t.textContent;
    if (!s.trim() || !el || /^(SCRIPT|STYLE|CODE|PRE)$/.test(el.tagName) || !visible(el)) continue;
    if (GLYPH.test(s.trim())) add('glyph-instead-of-icon', el, { text: s.trim() });
    for (const [key, re, skip] of TYPO) { if (skip && skip.test(s)) continue; const m = s.match(re); if (m) add('typo:' + key, el, { match: m[0], text: s.trim().slice(0, 50) }); }
  }

  // 7. Семантика заголовков
  const hEls = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible), hs = hEls.map(h => +h.tagName[1]);
  if (hs.filter(l => l === 1).length !== 1) out['h1-count'] = { count: hs.filter(l => l === 1).length };
  hs.forEach((l, i) => { if (i && l > hs[i - 1] + 1) add('heading-level-skipped', hEls[i], { from: hs[i - 1], to: l }); });

  return {
    url: location.href, viewport: `${vw}x${innerHeight}`, dpr: devicePixelRatio,
    reducedMotionRules: [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => /prefers-reduced-motion/.test(r.conditionText || r.media?.mediaText || '')); } catch { return false; } }),
    summary: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.count])),
    details: out,
  };
})()

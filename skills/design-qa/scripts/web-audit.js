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

  // 3a. Анимация отклика: у каждого интерактивного элемента должен быть переход состояний
  const secs = v => Math.max(0, ...v.split(',').map(x => parseFloat(x) * (x.trim().endsWith('ms') ? 0.001 : 1)));
  const clickable = new Set(interactive);
  for (const el of all) if (visible(el) && getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) clickable.add(el);
  for (const el of clickable) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && /checkbox|radio|hidden/.test(el.type || '')) continue;
    const cs = getComputedStyle(el);
    // переход может висеть на самом элементе или на его первом визуальном потомке (подложка, иконка)
    const own = secs(cs.transitionDuration), anim = cs.animationName !== 'none';
    const kid = [...el.querySelectorAll('*')].slice(0, 6).some(k => secs(getComputedStyle(k).transitionDuration) > 0);
    if (!own && !anim && !kid) add('no-interaction-transition', el, { tag: el.tagName.toLowerCase(), text: short(el) });
    else if (own > 0.5) add('slow-interaction-transition', el, { duration: own + 's', text: short(el) });
    else if (own && /^linear$/.test(cs.transitionTimingFunction.trim())) add('linear-easing', el, { text: short(el) });
  }

  // 3b. Системные контролы: выпадающие списки, пикеры и чекбоксы в стиле ОС
  for (const el of root.querySelectorAll('select')) {
    if (!visible(el)) continue;
    const ap = getComputedStyle(el).appearance;
    if (ap !== 'base-select') add('native-select', el, { appearance: ap, options: el.options.length, note: 'открытый список рисует ОС, стилями не меняется' });
  }
  for (const el of root.querySelectorAll('input')) {
    if (!visible(el)) continue;
    const t = el.type, ap = getComputedStyle(el).appearance;
    if (/^(checkbox|radio|range)$/.test(t) && ap !== 'none') add('native-' + t, el, { appearance: ap });
    if (/^(date|time|datetime-local|month|week|color|file)$/.test(t)) add('native-picker', el, { type: t });
    if (el.hasAttribute('list')) add('native-datalist', el, { list: el.getAttribute('list') });
  }
  for (const el of interactive) if (el.hasAttribute('title') && !el.getAttribute('aria-label')) add('native-title-tooltip', el, { title: el.title.slice(0, 40) });

  // 3c. Мобильная версия: проверки, которые имеют смысл только на узком экране
  if (vw < 768) {
    const vp = document.querySelector('meta[name=viewport]');
    const vc = vp ? vp.content.replace(/\s/g, '') : '';
    if (!/width=device-width/.test(vc)) add('viewport-meta', document.documentElement, { content: vc || 'нет meta viewport' });
    if (/user-scalable=(no|0)|maximum-scale=1(\.0)?(,|$)/.test(vc)) add('viewport-meta', document.documentElement, { content: vc, note: 'запрещено масштабирование' });
    // iOS зумит страницу при фокусе на поле с текстом меньше 16px
    for (const el of root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), select, textarea'))
      if (visible(el) && parseFloat(getComputedStyle(el).fontSize) < 16) add('ios-input-zoom', el, { fontSize: getComputedStyle(el).fontSize });
    const smallText = new Set();
    for (const el of all) {
      if (!visible(el) || smallText.has(el) || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 12) { smallText.add(el); add('mobile-small-text', el, { fontSize: getComputedStyle(el).fontSize, text: short(el) }); }
    }
    // Фиксированные и sticky-панели вместе не должны съедать больше четверти экрана
    let chrome = 0; const bars = [];
    for (const el of all) {
      const pos = getComputedStyle(el).position;
      if ((pos === 'fixed' || pos === 'sticky') && visible(el)) {
        const r = el.getBoundingClientRect();
        if (r.width > vw * 0.6 && r.height < innerHeight * 0.9 && !bars.some(b => b.contains(el))) { bars.push(el); chrome += Math.min(r.height, innerHeight); }
      }
    }
    if (chrome > innerHeight * 0.25) add('fixed-chrome-too-tall', document.documentElement, { px: Math.round(chrome), share: Math.round(chrome / innerHeight * 100) + '%', bars: bars.map(sel).slice(0, 5) });
    // Мелкие цели слишком близко друг к другу
    const small = interactive.filter(el => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44; });
    for (let i = 0; i < small.length; i++) for (let j = i + 1; j < small.length; j++) {
      const a = small[i].getBoundingClientRect(), b = small[j].getBoundingClientRect();
      const gap = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
      if (gap >= 0 && gap < 8 && !small[i].contains(small[j]) && !small[j].contains(small[i])) add('crowded-tap-targets', small[i], { gap: Math.round(gap), with: sel(small[j]) });
    }
    // Искажённые картинки
    for (const img of root.querySelectorAll('img')) {
      if (!visible(img) || !img.naturalWidth) continue;
      const r = img.getBoundingClientRect(), fit = getComputedStyle(img).objectFit;
      const k = (r.width / r.height) / (img.naturalWidth / img.naturalHeight);
      if (fit === 'fill' && (k > 1.05 || k < 0.95)) add('image-distorted', img, { stretch: +k.toFixed(2), src: img.currentSrc.split('/').pop() });
    }
  }
  // Контент, который появляется только при наведении: на телефоне до него не добраться
  const hoverOnly = [], vh100 = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = list => { for (const r of list) {
      if (r.cssRules) { if (!/hover:\s*hover|pointer:\s*fine/.test(r.conditionText || r.media?.mediaText || '')) walk(r.cssRules); continue; }
      if (!r.style) continue;
      const st = r.style;
      if (/:hover/.test(r.selectorText || '') && (/^(block|flex|grid|inline|inline-block|inline-flex)$/.test(st.display) || st.visibility === 'visible' || st.opacity === '1' || st.pointerEvents === 'auto')) hoverOnly.push(r.selectorText);
      if (/100vh/.test(st.height + st.minHeight + st.maxHeight)) vh100.push(r.selectorText);
    } };
    walk(rules);
  }
  if (hoverOnly.length) out['hover-only-content'] = { count: hoverOnly.length, examples: hoverOnly.slice(0, LIMIT), note: 'проверь, есть ли путь к этому контенту без наведения' };
  if (vh100.length) out['css-100vh'] = { count: vh100.length, examples: vh100.slice(0, LIMIT), note: 'в мобильном Safari низ обрезается панелью, нужен dvh/svh' };

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
    // все действия на экране: сравни списки на мобильной и десктопной ширине, чтобы найти пропавшие
    actions: [...new Set(interactive.map(el => (el.getAttribute('aria-label') || el.textContent || el.value || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean))].slice(0, 150),
    details: out,
  };
})()

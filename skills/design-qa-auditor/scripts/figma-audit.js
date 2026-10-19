// Design QA: автоматический обход Figma-узла. Только чтение, ничего не меняет.
// Использование: подставь ROOT_ID (фрейм, секция или страница) и передай весь текст в use_figma как code.
// Возвращает сводку: счётчики по категориям + до LIMIT примеров с id и путём слоя.
const ROOT_ID = '__ROOT_ID__';
const LIMIT = 12;

const root = await figma.getNodeByIdAsync(ROOT_ID);
if (!root) throw new Error('Узел не найден: ' + ROOT_ID);
let page = root;
while (page && page.type !== 'PAGE') page = page.parent;
if (page) await figma.setCurrentPageAsync(page);

const out = {};
const add = (key, node, extra) => {
  const b = out[key] || (out[key] = { count: 0, examples: [] });
  b.count++;
  if (b.examples.length < LIMIT) b.examples.push({ id: node.id, path: pathOf(node), ...(extra || {}) });
};
const pathOf = n => { const p = []; while (n && n !== root.parent && n.type !== 'PAGE') { p.unshift(n.name); n = n.parent; } return p.slice(-4).join(' / '); };
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const insideInstance = n => { for (let p = n.parent; p && p !== root.parent; p = p.parent) if (p.type === 'INSTANCE') return true; return false; };

// Plugin API бросает ошибку на свойстве, которого нет у типа узла, поэтому читаем через g()
const g = (n, k) => { try { return n[k]; } catch (e) { return undefined; } };

const rawColors = {};
const GLYPH = /^[+\-−–—→←↑↓›‹»«✓✔✕✖×✗]$/;
const TYPO = [
  ['straight-quotes', /"[^"]*"/],
  ['spaced-hyphen-as-dash', / - /],
  ['no-nbsp-before-unit', /\d (₽|%|руб|мин|ч|дн|ГБ|МБ|шт)/],
  ['no-nbsp-after-short-word', /(^|[\s(«])(в|во|и|к|ко|с|со|у|о|об|а|на|по|за|из|от|до|не|ни|но|для|при|без) (?=\S)/i],
  ['ungrouped-thousands', /(^|[^\d.,])\d{5,}(?![\d.,])/, /[№#]\s?\d|\+\d|\d{2}:\d{2}/], // третий элемент: когда не считать (номера, телефоны, время)
  ['triple-dot', /\.\.\./],
];

const nodes = root.findAll ? [root, ...root.findAll(() => true)] : [root];
for (const n of nodes) {
  if (g(n, 'visible') === false) { if (!insideInstance(n)) add('hidden-layer', n); continue; }
  const inInst = insideInstance(n);

  // Цвета: SOLID без переменной и без стиля
  for (const prop of ['fills', 'strokes']) {
    const paints = g(n, prop);
    if (!Array.isArray(paints)) continue;
    const styleId = prop === 'fills' ? g(n, 'fillStyleId') : g(n, 'strokeStyleId');
    if (styleId && typeof styleId === 'string') continue;
    for (const p of paints) {
      if (p.type !== 'SOLID' || p.visible === false) continue;
      if (p.boundVariables && p.boundVariables.color) continue;
      const h = hex(p.color);
      rawColors[h] = (rawColors[h] || 0) + 1;
      if (!inInst) add('hardcoded-color', n, { prop, value: h });
    }
  }

  // Отступы, gap, радиус: числа без переменной
  if (!inInst && g(n, 'layoutMode') !== undefined) {
    const bv = g(n, 'boundVariables') || {};
    const keys = g(n, 'layoutMode') !== 'NONE' ? ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing'] : [];
    if (typeof g(n, 'cornerRadius') === 'number') keys.push('cornerRadius');
    const raw = keys.filter(k => typeof g(n, k) === 'number' && g(n, k) > 0 && !bv[k] && !(k === 'cornerRadius' && bv.topLeftRadius));
    if (raw.length) add('hardcoded-spacing-radius', n, { values: Object.fromEntries(raw.map(k => [k, g(n, k)])) });
  }

  // Auto Layout: абсолют внутри потока, Fixed Height у контейнера с текстом
  if (!inInst && g(n, 'layoutPositioning') === 'ABSOLUTE') add('absolute-in-autolayout', n);
  if (!inInst && n.type === 'FRAME' && g(n, 'layoutMode') && g(n, 'layoutMode') !== 'NONE' && g(n, 'layoutSizingVertical') === 'FIXED' && n.findOne && n.findOne(c => c.type === 'TEXT'))
    add('fixed-height-with-text', n, { h: Math.round(n.height) });
  if (!inInst && n.type === 'FRAME' && g(n, 'layoutMode') === 'NONE' && n.children && n.children.length > 1 && n.children.some(c => c.type === 'TEXT'))
    add('no-autolayout-frame-with-text', n);

  // Компоненты: отвязанные инстансы
  if (n.type === 'FRAME' && g(n, 'detachedInfo')) add('detached-instance', n);

  // Пустые фреймы
  if (!inInst && n.type === 'FRAME' && n.children && n.children.length === 0 && !(Array.isArray(g(n, 'fills')) && g(n, 'fills').some(f => f.visible !== false))) add('empty-frame', n);

  // Тап-зоны у кнопок
  if (/button|btn|кнопк|chip|tab\b|toggle|checkbox|radio/i.test(n.name) && (n.type === 'INSTANCE' || n.type === 'COMPONENT' || n.type === 'FRAME') && n.height < 44 && n.height > 0)
    if (!inInst) add('small-tap-target', n, { w: Math.round(n.width), h: Math.round(n.height) });

  if (n.type !== 'TEXT') continue;
  const txt = n.characters;

  // Типографика: текст без стиля
  const styled = g(n, 'textStyleId') && g(n, 'textStyleId') !== '';
  const fsVar = g(n, 'boundVariables') && g(n, 'boundVariables').fontSize;
  if (!inInst && !styled && !fsVar) add('text-without-style', n, { text: txt.slice(0, 40) });
  if (!inInst && g(n, 'textStyleId') === figma.mixed) add('text-mixed-styles', n, { text: txt.slice(0, 40) });

  // Обрезка текста: фиксированная рамка или усечение
  if (g(n, 'textAutoResize') === 'NONE') add('text-fixed-box', n, { text: txt.slice(0, 40) });
  if (g(n, 'textTruncation') === 'ENDING') add('text-truncated', n, { text: txt.slice(0, 40), maxLines: g(n, 'maxLines') });

  // Символ вместо иконки
  if (GLYPH.test(txt.trim())) add('glyph-instead-of-icon', n, { text: txt.trim() });

  // Русская типографика
  for (const [key, re, skip] of TYPO) { if (skip && skip.test(txt)) continue; const m = txt.match(re); if (m) add('typo:' + key, n, { match: m[0].replace(/ /g, '⍽'), text: txt.slice(0, 50) }); }
}

// Анимация и состояния у интерактивных компонентов: варианты hover/pressed и прототипные переходы
const INTER = /button|btn|кнопк|chip|tab|toggle|switch|checkbox|radio|select|dropdown|input|field|link|card|row|item|accordion/i;
const sets = [];
for (const i of root.findAllWithCriteria ? root.findAllWithCriteria({ types: ['INSTANCE'] }) : []) { const mc = await i.getMainComponentAsync(); if (mc) sets.push(mc); }
const seenSets = new Set();
for (const mc of sets) {
  const owner = mc.parent && mc.parent.type === 'COMPONENT_SET' ? mc.parent : mc;
  if (seenSets.has(owner.id) || !INTER.test(owner.name) || /^(icon|ico|logo|system)\b|\/icon\b/i.test(owner.name)) continue;
  seenSets.add(owner.id);
  const variants = owner.type === 'COMPONENT_SET' ? owner.children : [owner];
  const names = variants.map(v => v.name.toLowerCase()).join(' | ');
  const missing = [['hover', /hover|навед/], ['pressed', /press|active|нажат/], ['focus', /focus|фокус/], ['disabled', /disabled|неактив/]].filter(([, re]) => !re.test(names)).map(([k]) => k);
  if (missing.length) add('component-missing-states', owner, { missing });
  const reactions = variants.flatMap(v => g(v, 'reactions') || []);
  const animated = reactions.some(r => (r.actions || [r.action]).some(a => a && a.transition && a.transition.type !== 'INSTANT'));
  if (!animated) add('component-no-animated-transition', owner, { reactions: reactions.length });
}

const topColors = Object.entries(rawColors).sort((a, b) => b[1] - a[1]).slice(0, 15);
const vars = await figma.variables.getLocalVariablesAsync();
return {
  root: { id: root.id, name: root.name, type: root.type, nodes: nodes.length },
  localVariables: vars.length,
  summary: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.count])),
  topHardcodedColors: topColors,
  details: out,
};

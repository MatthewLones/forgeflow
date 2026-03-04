/**
 * Global tooltip for [data-tooltip] elements.
 * Appears near the initial hover position and stays locked there until
 * the cursor leaves the chip. Works across React components, injected
 * HTML, and CodeMirror decorations.
 *
 * Call `initTooltip()` once at app startup.
 */

let tooltipEl: HTMLDivElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let currentTarget: Element | null = null;

const DELAY_MS = 350;
const OFFSET_X = 12;
const OFFSET_Y = -8;

function getTooltipEl(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'forge-tooltip';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function show(text: string, x: number, y: number) {
  const el = getTooltipEl();
  el.textContent = text;
  el.classList.add('visible');
  position(el, x, y);
}

function position(el: HTMLDivElement, mouseX: number, mouseY: number) {
  // Place to the right and slightly above the cursor
  let x = mouseX + OFFSET_X;
  let y = mouseY + OFFSET_Y;

  // Measure so we can clamp to viewport
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // If it would overflow right, flip to left of cursor
  if (x + rect.width > vw - 8) {
    x = mouseX - rect.width - OFFSET_X;
  }
  // If it would overflow bottom, move above cursor
  if (y + rect.height > vh - 8) {
    y = mouseY - rect.height - 4;
  }
  // Clamp to top/left edges
  if (x < 8) x = 8;
  if (y < 8) y = 8;

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function hide() {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  currentTarget = null;
  const el = getTooltipEl();
  el.classList.remove('visible');
}

function onMouseOver(e: MouseEvent) {
  const target = (e.target as Element)?.closest?.('[data-tooltip]');
  if (!target) return;
  const text = target.getAttribute('data-tooltip');
  if (!text) return;

  if (target === currentTarget) return;
  currentTarget = target;

  // Clear any pending show from a previous target
  if (showTimer) clearTimeout(showTimer);

  showTimer = setTimeout(() => {
    show(text, e.clientX, e.clientY);
  }, DELAY_MS);
}

function onMouseMove(e: MouseEvent) {
  const target = (e.target as Element)?.closest?.('[data-tooltip]');
  if (!target || target !== currentTarget) {
    if (currentTarget) hide();
  }
}

function onMouseOut(e: MouseEvent) {
  const target = (e.target as Element)?.closest?.('[data-tooltip]');
  const related = (e.relatedTarget as Element)?.closest?.('[data-tooltip]');
  if (target === currentTarget && related !== currentTarget) {
    hide();
  }
}

export function initTooltip() {
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseout', onMouseOut, true);
  // Hide on scroll (any scrollable ancestor)
  document.addEventListener('scroll', hide, true);
}

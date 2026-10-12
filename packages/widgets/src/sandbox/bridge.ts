/**
 * Sandbox bridge (CONTRACTS §5, PLAN §17): message types, host-side validation, the bridge script
 * injected into every frame document, the document wrapper and CSP the sandbox origin serves, and the
 * static pre-scan that rejects network APIs. No React: the server imports this module.
 *
 * Frames run on the sandbox origin (http://127.0.0.1:<port+1>/frame/:token) with
 * sandbox="allow-scripts" (no same-origin). The host accepts a message only when
 * event.source === iframe.contentWindow, then validates it here. The host grades; the frame only
 * reports the learner's value.
 */
import { FrameToHost, HostToFrame } from "@learncroc/core";

export type { FrameToHost as FrameToHostMessage, HostToFrame as HostToFrameMessage } from "@learncroc/core";
export { FrameToHost, HostToFrame };

/** `report` values are capped at 4 KB serialised. */
export const REPORT_MAX_BYTES = 4096;
/** `announce` text is capped at 120 characters. */
export const ANNOUNCE_MAX_CHARS = 120;
/** `resize` heights are clamped to 120..900. */
export const FRAME_MIN_HEIGHT = 120;
export const FRAME_MAX_HEIGHT = 900;
/** A frame must post `ready` within this time or it is dropped. */
export const READY_TIMEOUT_MS = 2000;
/** A frame must answer a `selftest` within this time. */
export const SELFTEST_TIMEOUT_MS = 2000;
/** Pack interactives and generated toys are at most 64 KB. */
export const FRAME_HTML_MAX_BYTES = 64 * 1024;

export function clampFrameHeight(h: number): number {
  if (!Number.isFinite(h)) return FRAME_MIN_HEIGHT;
  return Math.max(FRAME_MIN_HEIGHT, Math.min(FRAME_MAX_HEIGHT, Math.round(h)));
}

/** Validate a message from a frame. Returns null for anything malformed or over the caps. */
export function parseFrameMessage(data: unknown): FrameToHost | null {
  const parsed = FrameToHost.safeParse(data);
  if (!parsed.success) return null;
  const msg = parsed.data;
  if (msg.type === "report") {
    let bytes: number;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(msg.value)).length;
    } catch {
      return null;
    }
    if (bytes > REPORT_MAX_BYTES) return null;
    if (typeof msg.value === "number" && !Number.isFinite(msg.value)) return null;
    // Rebuild so nothing but the contract's fields ever reaches the host.
    return { type: "report", value: Array.isArray(msg.value) ? [...msg.value] : msg.value };
  }
  if (msg.type === "announce") {
    if (msg.text.length > ANNOUNCE_MAX_CHARS) return null;
    return { type: "announce", text: msg.text };
  }
  if (msg.type === "resize") return Number.isFinite(msg.height) ? { type: "resize", height: msg.height } : null;
  if (msg.type === "ready") return { type: "ready", v: 1 };
  return { type: "selftest", ok: msg.ok };
}

/** The CSS custom properties the host forwards to a frame in `init.tokens`. */
export const FRAME_TOKEN_NAMES = [
  "--bg",
  "--surface",
  "--surface-2",
  "--surface-sunk",
  "--line",
  "--line-strong",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--sea",
  "--sea-soft",
  "--sea-text",
  "--ember-text",
  "--iris",
  "--focus",
  "--w-ground",
  "--w-ink",
  "--w-ink-2",
  "--w-grid",
  "--w-1",
  "--w-2",
  "--w-3",
  "--w-4",
  "--w-5",
  "--font-recursive",
  "--r-sm",
  "--r-md",
  "--dur-quick",
  "--dur-base",
  "--dur-move",
  "--ease-out",
] as const;

/**
 * The bridge script injected first into every frame document. It exposes a frozen `window.lm`:
 *
 * - `lm.ready()` call once when interactive (a frame that never calls it is dropped after 2 s)
 * - `lm.report(value)` the learner's current value: string | number | boolean | string[] (≤ 4 KB)
 * - `lm.resize(px)` request a height (the host clamps it to 120..900; automatic by default)
 * - `lm.announce(text)` a short (≤ 120 chars) screen-reader announcement
 * - `lm.onInit(fn)` receives { mode, theme, reducedMotion, value, solution } (now and on change)
 * - `lm.onReveal(fn)` receives the solution when the host reveals it (review)
 * - `lm.onTest(fn)` registers fn(value) that puts the widget into the state for `value` and reports it
 * - `lm.mode`, `lm.theme`, `lm.reducedMotion`, `lm.value`, `lm.solution` (read-only, current)
 * - helpers `lm.scale(domain, range)` and `lm.drag(el, { axis, onMove })` (pointer + arrow keys)
 *
 * Theme tokens arrive as CSS variables (the app's names, e.g. `--ink`, `--w-1`) plus the short
 * aliases `--lm-bg`, `--lm-ink`, `--lm-ink-2`, `--lm-muted`, `--lm-line`, `--lm-accent`,
 * `--lm-accent-2`, `--lm-focus`, `--lm-font`, `--lm-radius`.
 */
export const BRIDGE_SCRIPT = `(function(){
"use strict";
var P=window.parent;
if(!P||P===window)return;
var S={mode:"explore",theme:"light",reducedMotion:false,value:undefined,solution:undefined,ready:false,init:false};
var initFns=[],revealFns=[],testFn=null,reports=0,lastH=0,raf=0;
var ALIAS={"--lm-bg":"--w-ground","--lm-ink":"--w-ink","--lm-ink-2":"--w-ink-2","--lm-muted":"--ink-3","--lm-line":"--line","--lm-accent":"--sea","--lm-accent-2":"--w-1","--lm-focus":"--focus","--lm-font":"--font-recursive","--lm-radius":"--r-md"};
function post(m){try{P.postMessage(m,"*");}catch(e){}}
function okValue(v){
  if(typeof v==="string"||typeof v==="boolean")return true;
  if(typeof v==="number")return isFinite(v);
  if(Array.isArray(v)){for(var i=0;i<v.length;i++){if(typeof v[i]!=="string")return false;}return true;}
  return false;
}
function snapshot(){return{mode:S.mode,theme:S.theme,reducedMotion:S.reducedMotion,value:S.value,solution:S.solution};}
function applyTokens(t){
  var r=document.documentElement;if(!t||typeof t!=="object")return;
  for(var k in t){if(Object.prototype.hasOwnProperty.call(t,k)&&/^--[a-z0-9-]{1,40}$/.test(k)&&typeof t[k]==="string"&&t[k].length<200&&!/[;{}<>]|url\\(/i.test(t[k])){r.style.setProperty(k,t[k]);}}
  for(var a in ALIAS){if(typeof t[ALIAS[a]]==="string"&&t[ALIAS[a]]){r.style.setProperty(a,"var("+ALIAS[a]+")");}}
}
function measure(){
  raf=0;if(!S.ready)return;
  var h=Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0));
  if(h&&Math.abs(h-lastH)>2){lastH=h;post({type:"resize",height:h});}
}
function schedule(){if(!raf){raf=(window.requestAnimationFrame||setTimeout)(measure);}}
function selftest(){
  var sel='input:not([type=hidden]):not([disabled]),button:not([disabled]),select,textarea,[role=slider],[tabindex]:not([tabindex="-1"])';
  var el=document.querySelector(sel);
  if(!el){post({type:"selftest",ok:false});return;}
  var changed=false,before=reports;
  var mo=new MutationObserver(function(){changed=true;});
  mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
  try{
    el.focus();
    var tag=el.tagName.toLowerCase(),type=(el.getAttribute("type")||"").toLowerCase();
    if(tag==="input"&&(type==="range"||type==="number")){
      if(el.stepUp){try{el.stepUp();}catch(e){}}
      if(String(el.value)===String(el.defaultValue)&&el.stepDown){try{el.stepDown();el.stepDown();}catch(e){}}
      el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));
    }else if(tag==="input"&&(type==="checkbox"||type==="radio")){el.click();}
    else if(tag==="input"||tag==="textarea"){el.value=String(el.value||"")+"a";el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}
    else if(tag==="select"){el.selectedIndex=(el.selectedIndex+1)%Math.max(1,el.options.length);el.dispatchEvent(new Event("change",{bubbles:true}));}
    else{
      el.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
      el.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true}));
      if(typeof el.click==="function")el.click();
    }
  }catch(e){}
  setTimeout(function(){mo.disconnect();post({type:"selftest",ok:changed||reports>before});},120);
}
window.addEventListener("message",function(e){
  if(e.source!==P)return;
  var d=e.data;if(!d||typeof d!=="object")return;
  if(d.type==="init"){
    S.mode=d.mode==="answer"||d.mode==="review"?d.mode:"explore";
    S.theme=d.theme==="dark"?"dark":"light";
    S.reducedMotion=d.reducedMotion===true;
    S.value=d.value;S.solution=d.solution;S.init=true;
    applyTokens(d.tokens);
    var r=document.documentElement;r.setAttribute("data-theme",S.theme);r.setAttribute("data-mode",S.mode);
    r.style.colorScheme=S.theme;
    if(S.reducedMotion)r.setAttribute("data-reduced-motion","");else r.removeAttribute("data-reduced-motion");
    for(var i=0;i<initFns.length;i++){try{initFns[i](snapshot());}catch(err){console.error(err);}}
  }else if(d.type==="selftest"){selftest();}
  else if(d.type==="reveal"){
    S.solution=d.solution;S.mode="review";document.documentElement.setAttribute("data-mode","review");
    for(var j=0;j<revealFns.length;j++){try{revealFns[j](d.solution);}catch(err){console.error(err);}}
  }
});
var lm={
  ready:function(){if(S.ready)return;S.ready=true;post({type:"ready",v:1});schedule();},
  report:function(v){if(!okValue(v)){console.warn("lm.report: value must be a string, number, boolean or string[]");return;}reports++;post({type:"report",value:v});},
  resize:function(h){var n=Number(h);if(isFinite(n)){lastH=n;post({type:"resize",height:n});}},
  announce:function(t){post({type:"announce",text:String(t).slice(0,120)});},
  onInit:function(fn){if(typeof fn==="function"){initFns.push(fn);if(S.init){try{fn(snapshot());}catch(e){console.error(e);}}}},
  onReveal:function(fn){if(typeof fn==="function")revealFns.push(fn);},
  onTest:function(fn){if(typeof fn==="function")testFn=fn;},
  test:function(v){if(testFn)testFn(v);},
  scale:function(d,r){var d0=+d[0],d1=+d[1],r0=+r[0],r1=+r[1];return function(x){return d1===d0?r0:r0+(x-d0)*(r1-r0)/(d1-d0);};},
  drag:function(el,o){
    o=o||{};var axis=o.axis||"both";
    function at(ev){var b=el.parentNode&&el.parentNode.getBoundingClientRect?el.parentNode.getBoundingClientRect():el.getBoundingClientRect();
      var x=b.width?(ev.clientX-b.left)/b.width:0,y=b.height?(ev.clientY-b.top)/b.height:0;
      x=Math.max(0,Math.min(1,x));y=Math.max(0,Math.min(1,y));
      if(o.onMove)o.onMove({x:axis==="y"?null:x,y:axis==="x"?null:y,source:"pointer"});}
    el.style.touchAction="none";
    if(!el.hasAttribute("tabindex"))el.setAttribute("tabindex","0");
    el.addEventListener("pointerdown",function(ev){if(ev.button!==0)return;ev.preventDefault();if(el.setPointerCapture)el.setPointerCapture(ev.pointerId);at(ev);
      function mv(e2){at(e2);}function up(){el.removeEventListener("pointermove",mv);el.removeEventListener("pointerup",up);el.removeEventListener("pointercancel",up);if(o.onEnd)o.onEnd();}
      el.addEventListener("pointermove",mv);el.addEventListener("pointerup",up);el.addEventListener("pointercancel",up);});
    el.addEventListener("keydown",function(ev){var s=(ev.shiftKey?10:1)*(o.step||0.02),dx=0,dy=0;
      if(ev.key==="ArrowLeft")dx=-s;else if(ev.key==="ArrowRight")dx=s;else if(ev.key==="ArrowUp")dy=-s;else if(ev.key==="ArrowDown")dy=s;else return;
      if(axis==="x")dy=0;if(axis==="y")dx=0;if(!dx&&!dy)return;ev.preventDefault();
      if(o.onMove)o.onMove({dx:dx,dy:dy,source:"keyboard"});});
  }
};
Object.defineProperty(lm,"mode",{get:function(){return S.mode;}});
Object.defineProperty(lm,"theme",{get:function(){return S.theme;}});
Object.defineProperty(lm,"reducedMotion",{get:function(){return S.reducedMotion;}});
Object.defineProperty(lm,"value",{get:function(){return S.value;}});
Object.defineProperty(lm,"solution",{get:function(){return S.solution;}});
Object.freeze(lm);
try{Object.defineProperty(window,"lm",{value:lm,writable:false,configurable:false});}catch(e){window.lm=lm;}
if(window.ResizeObserver){var ro=new ResizeObserver(schedule);var obs=function(){ro.observe(document.documentElement);if(document.body)ro.observe(document.body);};if(document.body)obs();else document.addEventListener("DOMContentLoaded",obs);}
window.addEventListener("load",schedule);
})();`;

/** Base styles every frame document gets (theme variables, focus ring, reduced motion). */
export const FRAME_BASE_CSS = `:root{color-scheme:light;font-family:var(--lm-font,ui-sans-serif,system-ui,sans-serif);background:var(--lm-bg,transparent);color:var(--lm-ink,#1c1a3d)}
html,body{margin:0;padding:0}body{padding:12px;font-size:16px;line-height:24px}
:focus-visible{outline:3px solid var(--lm-focus,#12877a);outline-offset:2px}
[data-reduced-motion] *,[data-reduced-motion] *::before,[data-reduced-motion] *::after{animation:none!important;transition:none!important}`;

/** Defence-in-depth CSP inside the document (the sandbox listener also sends it as a header). */
export const FRAME_META_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; form-action 'none'; base-uri 'none'";

/**
 * The response CSP for GET /frame/:token on the sandbox origin (PLAN §17): no network, inline code
 * only, and only the app may frame it.
 */
export function frameCsp(mainPort: number): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors http://127.0.0.1:${mainPort} http://localhost:${mainPort}`,
  ].join("; ");
}

/**
 * Wrap a pack interactive (or generated toy) for the sandbox origin: a CSP meta, the base styles and
 * the bridge script go first in <head>, before any author code runs.
 */
export function wrapFrameDocument(html: string, opts: { title?: string } = {}): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_META_CSP}"><meta name="viewport" content="width=device-width,initial-scale=1">${
    opts.title ? `<title>${escapeHtml(opts.title)}</title>` : ""
  }<style>${FRAME_BASE_CSS}</style><script>${BRIDGE_SCRIPT}</script>`;
  const headOpen = /<head(\s[^>]*)?>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + head + html.slice(at);
  }
  const htmlOpen = /<html(\s[^>]*)?>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${head}</head>${html.slice(at)}`;
  }
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface FrameScanIssue {
  rule: string;
  message: string;
  /** 1-based line of the first match. */
  line?: number;
}

const SCAN_RULES: { rule: string; re: RegExp; message: string }[] = [
  { rule: "network", re: /\bfetch\s*\(/, message: "fetch() is not allowed (no network)" },
  { rule: "network", re: /\bXMLHttpRequest\b/, message: "XMLHttpRequest is not allowed (no network)" },
  { rule: "network", re: /\bWebSocket\b/, message: "WebSocket is not allowed (no network)" },
  { rule: "network", re: /\bEventSource\b/, message: "EventSource is not allowed (no network)" },
  { rule: "network", re: /\bsendBeacon\b/, message: "navigator.sendBeacon is not allowed (no network)" },
  { rule: "network", re: /\bRTCPeerConnection\b/, message: "WebRTC is not allowed (no network)" },
  { rule: "network", re: /\bimportScripts\b|\bnew\s+(Shared)?Worker\b/, message: "workers are not allowed" },
  { rule: "network", re: /\bimport\s*\(/, message: "dynamic import() is not allowed" },
  {
    rule: "network",
    re: /<\s*(link|base|iframe|frame|object|embed|portal)\b/i,
    message: "external-loading tags are not allowed",
  },
  { rule: "network", re: /<\s*form\b[^>]*\baction\s*=/i, message: "form actions are not allowed" },
  { rule: "network", re: /http-equiv\s*=\s*["']?refresh/i, message: "meta refresh is not allowed" },
  {
    rule: "external-url",
    re: /(?:src|href|action|poster|data)\s*=\s*["']?\s*(?:https?:)?\/\//i,
    message: "external URLs are not allowed",
  },
  { rule: "external-url", re: /url\(\s*["']?\s*(?:https?:)?\/\//i, message: "external URLs in CSS are not allowed" },
  { rule: "external-url", re: /@import\b/i, message: "CSS @import is not allowed" },
  {
    rule: "parent",
    re: /\b(?:window|self|globalThis)\s*\.\s*(?:top|opener|frameElement)\b|\btop\s*\.\s*(?:location|document|postMessage|window|frames)\b/,
    message: "window.top / window.opener are not allowed",
  },
  {
    rule: "parent",
    re: /\bparent\s*\.\s*(document|location|window|frames)\b/,
    message: "reaching into the parent is not allowed",
  },
  { rule: "parent", re: /\bpostMessage\s*\(/, message: "use lm.report / lm.announce instead of postMessage" },
  {
    rule: "storage",
    re: /\b(localStorage|sessionStorage|indexedDB)\b|\bcaches\s*\.|document\s*\.\s*cookie/,
    message: "storage is not allowed",
  },
  {
    rule: "eval",
    re: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*["'`]/,
    message: "eval / Function() are not allowed",
  },
  {
    rule: "navigation",
    re: /\b(location\s*\.\s*(href|assign|replace)|window\.open)\b/,
    message: "navigation is not allowed",
  },
];

/**
 * Static pre-scan for pack interactives and generated toys: size cap, no network APIs, no external
 * URLs, no reaching into the parent, no storage, no eval. [] = ok. The sandbox's CSP enforces the
 * same at runtime; this catches it at lint and install time with a readable reason.
 */
export function scanFrameHtml(html: string): FrameScanIssue[] {
  const issues: FrameScanIssue[] = [];
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > FRAME_HTML_MAX_BYTES) {
    issues.push({ rule: "size", message: `interactive is ${Math.ceil(bytes / 1024)} KB; the limit is 64 KB` });
  }
  for (const r of SCAN_RULES) {
    const m = r.re.exec(html);
    if (m) issues.push({ rule: r.rule, message: r.message, line: html.slice(0, m.index).split("\n").length });
  }
  if (!/\blm\s*\.\s*ready\s*\(/.test(html)) {
    issues.push({ rule: "bridge", message: "the interactive never calls lm.ready(), so the host would drop it" });
  }
  return issues;
}

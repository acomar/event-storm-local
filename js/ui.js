export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  plus:'M12 5v14M5 12h14', back:'m12 5-7 7 7 7M5 12h15', close:'m6 6 12 12M6 18 18 6', check:'m5 12 4 4L19 6',
  sun:'M12 3v2M12 19v2M3 12h2M19 12h2m-14-7 1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon:'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10', text:'M5 3h10l4 4v14H5V3m10 0v5h4M8 12h8M8 16h6',
  map:'M3 4h6v5H3zm12 0h6v5h-6zM9 15h6v6H9zM6 9v3h12V9M12 12v3', chat:'M4 4h16v13H9l-5 4V4M8 8h8M8 12h5',
  upload:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', download:'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5', history:'M4 4v5h5M4 9a8 8 0 1 1 0 7M12 7v5l3 2',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 5l2 2M18 17l2 2M5 20l2-2M17 6l2-2M3 12h2M19 12h2M12 3v2M12 19v2',
  folder:'M3 6h7l2 3h9v12H3V6', search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-2 4 7 7', undo:'m8 5-5 5 5 5M3 10h10a7 7 0 0 1 7 7', redo:'m16 5 5 5-5 5M21 10H11a7 7 0 0 0-7 7',
  grid:'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z', list:'M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1',
  warning:'m12 3 10 18H2L12 3m0 6v5m0 3v1', arrow:'M4 12h16m-6-6 6 6-6 6', layers:'m12 3 10 5-10 5L2 8l10-5M2 12l10 5 10-5M2 16l10 5 10-5', trash:'M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  copy:'M8 8h13v13H8V8M16 8V3H3v13h5', zoom:'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5', link:'m9 15 6-6M10 7l3-3a5 5 0 0 1 7 7l-3 3M7 10l-3 3a5 5 0 0 0 7 7l3-3', clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 6v6l4 2',
  bulb:'M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0l-1 3H9l-1-3', send:'m3 3 19 9-19 9 4-9-4-9m4 9h15', shield:'m12 3 9 4v5c0 6-9 10-9 10S3 18 3 12V7l9-4m-4 9 3 3 5-5'
};
export const icon = (name, size=18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.map}"/></svg>`;
export const button = (action,label,ico='',cls='secondary',extra='') => `<button type="button" class="${cls}" data-action="${action}" ${extra}>${ico?icon(ico):''}<span>${esc(label)}</span></button>`;
export const iconButton = (action,label,ico,extra='') => `<button type="button" class="icon-button" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${icon(ico)}</button>`;
export const logo = () => `<div class="logo"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span>EventStorm <b>Local</b></span></div>`;
export const date = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
export const options = (map,value) => Object.entries(map).map(([k,v])=>`<option value="${esc(k)}" ${k===value?'selected':''}>${esc(v.label??v)}</option>`).join('');
export function download(data,name,type='application/json') {const blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}

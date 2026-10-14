import {kinds,statuses,relations,connectionSides,contextDimensions,cardDimensions} from './domain.js';
import {esc,icon,iconButton} from './ui.js';

const sideNames={top:'superior',right:'direito',bottom:'inferior',left:'esquerdo'};
const normals={top:{x:0,y:-1},right:{x:1,y:0},bottom:{x:0,y:1},left:{x:-1,y:0}};
function normalizeSize(size,dimensions) {
  const finite=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
  return {width:Math.round(Math.min(dimensions.maxWidth,Math.max(dimensions.minWidth,finite(size.width,dimensions.width)))),height:Math.round(Math.min(dimensions.maxHeight,Math.max(dimensions.minHeight,finite(size.height,dimensions.height))))};
}
export function normalizeContextSize(size={}) { return normalizeSize(size,contextDimensions); }
export function normalizeCardSize(size={}) { return normalizeSize(size,cardDimensions); }
const nodeSize=(node,size)=>node?.kind==='context'?normalizeContextSize(size):normalizeCardSize(size);
export function nodeBounds(node,nodes=[]) {
  if(!node)return null;
  if(!node.position&&Number.isFinite(node.width)&&Number.isFinite(node.height))return {...node};
  const x=node.position.x,y=node.position.y;
  if(node.kind!=='context')return {x,y,...normalizeCardSize(node.properties)};
  const properties=node.properties||{},size=normalizeContextSize(properties);
  if(properties.width!==undefined||properties.height!==undefined)return {x,y,...size};
  const members=nodes.filter(item=>item.id!==node.id&&item.kind!=='context'&&item.context?.trim()&&item.context.trim().toLocaleLowerCase('pt-BR')===node.name?.trim().toLocaleLowerCase('pt-BR'));
  if(!members.length)return {x,y,...size};
  const left=Math.min(...members.map(item=>item.position.x))-36,top=Math.min(...members.map(item=>item.position.y))-64;
  const right=Math.max(...members.map(item=>item.position.x+normalizeCardSize(item.properties).width))+36,bottom=Math.max(...members.map(item=>item.position.y+normalizeCardSize(item.properties).height))+36;
  return {x:left,y:top,...normalizeContextSize({width:Math.max(size.width,right-left),height:Math.max(size.height,bottom-top)})};
}
export function edgeAnchors(edge,source,target,nodes=[]) {
  const s=nodeBounds(source,nodes),t=nodeBounds(target,nodes);if(!s||!t)return null;
  const dx=t.x+t.width/2-s.x-s.width/2,dy=t.y+t.height/2-s.y-s.height/2;
  const horizontal=Math.abs(dx)>=Math.abs(dy);
  const sourceSide=connectionSides.includes(edge.source_side)?edge.source_side:horizontal?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
  const targetSide=connectionSides.includes(edge.target_side)?edge.target_side:horizontal?(dx>=0?'left':'right'):(dy>=0?'top':'bottom');
  const anchor=(rect,side)=>({x:side==='left'?rect.x:side==='right'?rect.x+rect.width:rect.x+rect.width/2,y:side==='top'?rect.y:side==='bottom'?rect.y+rect.height:rect.y+rect.height/2,side});
  return {source:anchor(s,sourceSide),target:anchor(t,targetSide)};
}
export function edgeCurve(anchors) {
  const s=anchors.source,t=anchors.target,sn=normals[s.side],tn=normals[t.side],distance=Math.max(48,Math.min(280,Math.hypot(t.x-s.x,t.y-s.y)*.45));
  const c1={x:s.x+sn.x*distance,y:s.y+sn.y*distance},c2={x:t.x+tn.x*distance,y:t.y+tn.y*distance};
  return {path:`M${s.x} ${s.y} C${c1.x} ${c1.y},${c2.x} ${c2.y},${t.x} ${t.y}`,label:{x:(s.x+3*c1.x+3*c2.x+t.x)/8,y:(s.y+3*c1.y+3*c2.y+t.y)/8-8}};
}
const handles=node=>connectionSides.map(side=>`<button class="handle ${side}" data-side="${side}" aria-label="Conectar pelo lado ${sideNames[side]} de ${esc(node.name)}" title="Conectar pelo lado ${sideNames[side]}"></button>`).join('');
export class Board {
  constructor(container, api) {this.el=container;this.api=api;this.grid=true;this.abort=new AbortController();this.mount();}
  mount(){
    this.el.innerHTML=`<div class="board-caption"><strong>Exploração do domínio</strong><span class="board-count"></span></div><div class="world"><div class="contexts" role="listbox" aria-multiselectable="true" aria-label="Contextos do mapa"></div><svg class="connections" aria-label="Relações do mapa"><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="currentColor"/></marker></defs><g class="edge-group"></g></svg><div class="cards" role="listbox" aria-multiselectable="true" aria-label="Elementos do mapa"></div></div><span class="board-announcement" role="status" aria-live="polite"></span><div class="empty-canvas"><h2>O que aconteceu no seu negócio?</h2><p>Adicione um evento, dê um duplo clique no mapa<br>ou comece uma conversa com o facilitador.</p></div><div class="board-controls">${iconButton('zoom-out','Diminuir zoom','search')}<span class="zoom-value">100%</span>${iconButton('zoom-in','Aumentar zoom','plus')}${iconButton('fit','Ajustar mapa','zoom')}${iconButton('grid','Alternar grade','grid')}</div><svg class="minimap" role="button" tabindex="0" aria-label="Minimapa: centralizar mapa" viewBox="0 0 180 110"></svg>`;
    this.world=this.el.querySelector('.world');this.cards=this.el.querySelector('.cards');this.contexts=this.el.querySelector('.contexts');this.edges=this.el.querySelector('.edge-group');
    const opts={signal:this.abort.signal};
    this.el.addEventListener('pointerdown',e=>this.down(e),opts);
    this.el.addEventListener('dblclick',e=>{if(this.api.locked())return;if(e.target.closest('.sticky')){e.preventDefault();this.inline(e.target.closest('.sticky').dataset.id);}else if(!e.target.closest('button,.minimap'))this.api.add('event',this.point(e));},opts);
    this.el.addEventListener('contextmenu',e=>{e.preventDefault();const card=e.target.closest('.sticky');if(card)this.api.menu(card.dataset.id,e.clientX,e.clientY);},opts);
    this.el.addEventListener('wheel',e=>{if(this.api.locked()||e.target.closest('textarea,.sticky-description'))return;e.preventDefault();if(e.shiftKey){this.camera.x-=e.deltaY;this.camera.y-=e.deltaX;this.cameraChanged();}else this.zoom(Math.exp(-e.deltaY*.0015),e.clientX,e.clientY);},{...opts,passive:false});
    this.el.addEventListener('click',e=>{const a=e.target.closest('[data-action]')?.dataset.action;if(a==='zoom-in')this.zoom(1.2);if(a==='zoom-out')this.zoom(1/1.2);if(a==='fit')this.fit();if(a==='grid'){this.grid=!this.grid;this.el.classList.toggle('no-grid',!this.grid);e.target.closest('button').setAttribute('aria-pressed',String(this.grid));}if(e.target.closest('.minimap'))this.fit();const edge=e.target.closest('[data-edge]');if(edge)this.api.edge(edge.dataset.edge);},opts);
    this.el.querySelector('.minimap').addEventListener('keydown',e=>{if(e.key==='Enter')this.fit()},opts);
    this.el.addEventListener('keydown',e=>{
      const resize=e.target.closest('.node-resize');
      if(resize&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(e.key)){
        e.preventDefault();e.stopPropagation();if(this.api.locked())return;
        const id=resize.closest('.sticky').dataset.id,bounds=this.bounds(id),step=e.shiftKey?100:20;
        if(['Enter',' '].includes(e.key)){this.announce('Use as setas para redimensionar. Shift aumenta o passo para 100 pixels.');return;}
        const size=nodeSize(this.graph.nodes.find(n=>n.id===id),{width:bounds.width+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),height:bounds.height+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)});
        this.api.resize(id,size);this.cardElement(id)?.querySelector('.node-resize')?.focus();this.announce(`Elemento com ${size.width} por ${size.height} pixels.`);return;
      }
      const edge=e.target.closest('[data-edge]');
      if(edge&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();this.api.edge(edge.dataset.edge);return;}
      const handle=e.target.closest('.handle');
      if(handle&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();if(!this.api.locked())this.api.connectionStart(handle.closest('.sticky').dataset.id,handle.dataset.side);}
    },opts);
    this.el.addEventListener('click',e=>{const handle=e.target.closest('.handle');if(handle&&e.detail===0&&!this.api.locked()){e.stopPropagation();this.api.connectionStart(handle.closest('.sticky').dataset.id,handle.dataset.side);}},opts);
    this.update();
  }
  get graph(){return this.api.project().graph;}
  point(e){const r=this.el.getBoundingClientRect();return {x:(e.clientX-r.left-this.camera.x)/this.camera.zoom,y:(e.clientY-r.top-this.camera.y)/this.camera.zoom};}
  update(){
    this.camera={...this.graph.viewport};if(!Number.isFinite(this.camera.zoom))this.camera={x:40,y:80,zoom:.75};
    const nodes=this.graph.nodes.filter(this.api.visible);const selected=this.api.selection();
    this.cards.innerHTML=nodes.filter(n=>n.kind!=='context').map(n=>`<article class="sticky ${esc(n.kind)} ${selected.has(n.id)?'chosen':''}" data-id="${esc(n.id)}" style="left:${n.position.x}px;top:${n.position.y}px;width:${nodeBounds(n).width}px;height:${nodeBounds(n).height}px;--sticky:${kinds[n.kind].color}" tabindex="0" role="option" aria-label="${esc(kinds[n.kind].label)}: ${esc(n.name)}" aria-selected="${selected.has(n.id)}"><div class="sticky-type">${esc(kinds[n.kind].label)}<span>${n.properties.pivotal?'★':''}</span></div><div class="sticky-name">${esc(n.name)}</div>${n.description?`<div class="sticky-description" title="${esc(n.description)}">${esc(n.description)}</div>`:''}<div class="sticky-footer"><span>○ ${esc(statuses[n.status])}</span><span>${n.evidence_ids.length?`${n.evidence_ids.length} fonte${n.evidence_ids.length>1?'s':''}`:'Manual'}</span></div>${handles(n)}<button class="node-resize card-resize" aria-label="Redimensionar ${esc(n.name)}. Use as setas; Shift aumenta o passo." title="Arraste para redimensionar; use as setas pelo teclado">${icon('zoom',12)}</button></article>`).join('');
    this.contexts.innerHTML=nodes.filter(n=>n.kind==='context').map(n=>{const bounds=nodeBounds(n,this.graph.nodes);return `<article class="sticky context ${selected.has(n.id)?'chosen':''}" data-id="${esc(n.id)}" style="left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;height:${bounds.height}px;--sticky:${kinds.context.color}" tabindex="0" role="option" aria-label="Contexto: ${esc(n.name)}" aria-selected="${selected.has(n.id)}"><div class="context-title"><div class="sticky-type">Contexto</div><div class="sticky-name">${esc(n.name)}</div>${n.description?`<div class="sticky-description" title="${esc(n.description)}">${esc(n.description)}</div>`:''}</div>${connectionSides.map(side=>`<span class="context-grip ${side}" aria-hidden="true"></span>`).join('')}${handles(n)}<button class="node-resize context-resize" aria-label="Redimensionar contexto ${esc(n.name)}. Use as setas; Shift aumenta o passo." title="Arraste para redimensionar; use as setas pelo teclado">${icon('zoom',12)}</button></article>`;}).join('');
    this.el.querySelector('.empty-canvas').hidden=this.graph.nodes.length>0;
    this.el.querySelector('.board-count').textContent=`${this.graph.nodes.length} elementos · ${this.graph.edges.length} relações`;
    this.drawEdges();this.transform();this.mini(nodes);
  }
  transform(){this.world.style.transform=`translate(${this.camera.x}px,${this.camera.y}px) scale(${this.camera.zoom})`;this.el.style.backgroundSize=`${24*this.camera.zoom}px ${24*this.camera.zoom}px`;this.el.style.backgroundPosition=`${this.camera.x}px ${this.camera.y}px`;this.el.querySelector('.zoom-value').textContent=`${Math.round(this.camera.zoom*100)}%`;}
  cameraChanged(){if(this.api.locked())return;this.transform();this.api.viewport({...this.camera});}
  zoom(factor,cx,cy){if(this.api.locked())return;const r=this.el.getBoundingClientRect();const x=cx===undefined?r.width/2:cx-r.left,y=cy===undefined?r.height/2:cy-r.top;const old=this.camera.zoom,z=Math.min(2,Math.max(.12,old*factor));this.camera.x=x-(x-this.camera.x)*z/old;this.camera.y=y-(y-this.camera.y)*z/old;this.camera.zoom=z;this.cameraChanged();}
  fit(){if(this.api.locked())return;const ns=this.graph.nodes.filter(this.api.visible);if(!ns.length)return;const rects=ns.map(n=>nodeBounds(n,this.graph.nodes)),minX=Math.min(...rects.map(n=>n.x)),minY=Math.min(...rects.map(n=>n.y)),maxX=Math.max(...rects.map(n=>n.x+n.width)),maxY=Math.max(...rects.map(n=>n.y+n.height));const r=this.el.getBoundingClientRect(),z=Math.min(1,(r.width-100)/(maxX-minX),(r.height-140)/(maxY-minY));this.camera={x:(r.width-(maxX-minX)*z)/2-minX*z,y:(r.height-(maxY-minY)*z)/2-minY*z,zoom:Math.max(.12,z)};this.cameraChanged();}
  cardElement(id){const selector=`[data-id="${CSS.escape(id)}"]`;return this.cards.querySelector(selector)||this.contexts?.querySelector(selector);}
  coords(id){const dom=this.cardElement(id),n=this.graph.nodes.find(n=>n.id===id),bounds=nodeBounds(n,this.graph.nodes);return dom?{x:parseFloat(dom.style.left),y:parseFloat(dom.style.top)}:bounds?{x:bounds.x,y:bounds.y}:null;}
  bounds(id){const n=this.graph.nodes.find(n=>n.id===id),bounds=nodeBounds(n,this.graph.nodes);if(!bounds)return null;const dom=this.cardElement(id);return {...bounds,...this.coords(id),width:parseFloat(dom?.style.width)||bounds.width,height:parseFloat(dom?.style.height)||bounds.height};}
  drawEdges(){const ns=this.graph.nodes.filter(this.api.visible);const ids=new Set(ns.map(n=>n.id));this.edges.innerHTML=this.graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)).map(e=>{const anchors=edgeAnchors(e,this.bounds(e.source),this.bounds(e.target));if(!anchors)return '';const curve=edgeCurve(anchors);return `<g data-edge="${esc(e.id)}" role="button" tabindex="0" aria-label="${esc(relations[e.relation])}"><path class="edge-hit" d="${curve.path}"/><path class="edge-line" d="${curve.path}" marker-end="url(#arrow)"/><text x="${curve.label.x}" y="${curve.label.y}" text-anchor="middle">${esc(e.label||relations[e.relation])}</text></g>`;}).join('');}
  mini(ns){const m=this.el.querySelector('.minimap');if(!ns.length){m.innerHTML='';return;}const rects=ns.map(n=>({...nodeBounds(n,this.graph.nodes),node:n})),minX=Math.min(...rects.map(n=>n.x)),minY=Math.min(...rects.map(n=>n.y)),dx=Math.max(250,...rects.map(n=>n.x+n.width-minX)),dy=Math.max(170,...rects.map(n=>n.y+n.height-minY)),z=Math.min(160/dx,90/dy);m.innerHTML=rects.sort((a,b)=>(a.node.kind==='context'?0:1)-(b.node.kind==='context'?0:1)).map(n=>`<rect x="${10+(n.x-minX)*z}" y="${10+(n.y-minY)*z}" width="${n.width*z}" height="${n.height*z}" rx="1" fill="${n.node.kind==='context'?'none':kinds[n.node.kind].color}" ${n.node.kind==='context'?'stroke="#7890a6" stroke-dasharray="1 2"':''}/>`).join('');}
  inline(id){if(this.api.locked())return;const n=this.graph.nodes.find(n=>n.id===id),el=this.cardElement(id)?.querySelector('.sticky-name');if(!el||el.querySelector('textarea'))return;const input=document.createElement('textarea');input.value=n.name;input.maxLength=240;input.setAttribute('aria-label','Nome do elemento');el.replaceChildren(input);input.focus();input.select();const finish=()=>{const value=input.value.trim()||n.name;this.api.rename(id,value);};input.addEventListener('blur',finish,{once:true});input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();input.blur();}if(e.key==='Escape'){input.value=n.name;input.blur();}});}
  announce(message){const target=this.el.querySelector('.board-announcement');if(target)target.textContent=message;}
  down(e){
    if(e.target.closest('.board-controls,.minimap,textarea,[data-edge]'))return;
    const card=e.target.closest('.sticky'),handle=e.target.closest('.handle'),resize=e.target.closest('.node-resize');
    if(this.api.locked()){if(card&&!handle&&!resize)this.api.select(card.dataset.id,e.shiftKey,true);return;}
    if(e.button===2&&card)return;
    if(resize&&e.button===0){this.resize(e,card.dataset.id);return;}
    if(handle&&e.button===0){this.connect(e,card.dataset.id,handle.dataset.side);return;}
    if(card&&e.button===0){
      card.focus?.({preventScroll:true});
      const id=card.dataset.id;if(e.shiftKey)this.api.select(id,true,false);else if(!this.api.selection().has(id))this.api.select(id,false,false);
      const ids=[...this.api.selection()],start={x:e.clientX,y:e.clientY},positions=ids.map(id=>{const n=this.graph.nodes.find(item=>item.id===id),bounds=n.kind==='context'?this.bounds(id):null;return {id,...this.coords(id),...(bounds?{width:bounds.width,height:bounds.height}:{})};});let moved=false;
      const move=ev=>{const dx=(ev.clientX-start.x)/this.camera.zoom,dy=(ev.clientY-start.y)/this.camera.zoom;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;for(const p of positions){const d=this.cardElement(p.id);if(d){d.style.left=`${this.grid?Math.round((p.x+dx)/20)*20:p.x+dx}px`;d.style.top=`${this.grid?Math.round((p.y+dy)/20)*20:p.y+dy}px`;}}this.drawEdges();};
      const up=()=>{cleanup();if(this.api.locked()){this.update();return;}if(moved)this.api.move(positions.map(p=>({id:p.id,...this.coords(p.id),...(p.width!==undefined?{width:p.width,height:p.height}:{})})));else if(e.shiftKey)this.api.showSelection();else this.api.select(id,false,true);};
      const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});e.preventDefault();return;
    }
    if(e.shiftKey&&e.button===0){const start=this.point(e),box=document.createElement('div');box.className='selection-box';this.world.append(box);let end=start;const move=ev=>{end=this.point(ev);Object.assign(box.style,{left:`${Math.min(start.x,end.x)}px`,top:`${Math.min(start.y,end.y)}px`,width:`${Math.abs(end.x-start.x)}px`,height:`${Math.abs(end.y-start.y)}px`});};const up=()=>{window.removeEventListener('pointermove',move);box.remove();if(this.api.locked())return;this.api.selectMany(this.graph.nodes.filter(this.api.visible).filter(n=>{const b=nodeBounds(n,this.graph.nodes);return b.x+b.width>=Math.min(start.x,end.x)&&b.x<=Math.max(start.x,end.x)&&b.y+b.height>=Math.min(start.y,end.y)&&b.y<=Math.max(start.y,end.y)}).map(n=>n.id));this.api.showSelection();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});return;}
    const start={x:e.clientX,y:e.clientY,cx:this.camera.x,cy:this.camera.y};let moved=false;this.el.classList.add('panning');const move=ev=>{const dx=ev.clientX-start.x,dy=ev.clientY-start.y;moved ||= Math.abs(dx)+Math.abs(dy)>4;this.camera.x=start.cx+dx;this.camera.y=start.cy+dy;this.transform();};const up=()=>{window.removeEventListener('pointermove',move);this.el.classList.remove('panning');if(moved)this.cameraChanged();else this.api.select(null,false,true);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});e.preventDefault();
  }
  resize(e,id){
    if(this.api.locked())return;this.api.select(id,false,false);const node=this.graph.nodes.find(n=>n.id===id),bounds=this.bounds(id),element=this.cardElement(id),start={x:e.clientX,y:e.clientY};let size={width:bounds.width,height:bounds.height},moved=false;
    const move=ev=>{const dx=(ev.clientX-start.x)/this.camera.zoom,dy=(ev.clientY-start.y)/this.camera.zoom;moved ||= Math.abs(dx)+Math.abs(dy)>3;size=nodeSize(node,{width:bounds.width+dx,height:bounds.height+dy});if(this.grid)size=nodeSize(node,{width:Math.round(size.width/20)*20,height:Math.round(size.height/20)*20});element.style.width=`${size.width}px`;element.style.height=`${size.height}px`;this.drawEdges();};
    const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);};
    const up=()=>{cleanup();if(this.api.locked()){this.update();return;}if(moved)this.api.resize(id,size);this.cardElement(id)?.querySelector?.('.node-resize')?.focus?.();this.announce(`Elemento com ${size.width} por ${size.height} pixels.`);};
    const cancel=()=>{cleanup();this.update();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});window.addEventListener('pointercancel',cancel,{once:true});e.preventDefault();e.stopPropagation();
  }
  connect(e,id,side='right'){
    if(this.api.locked())return;const start=edgeAnchors({source_side:side},this.bounds(id),{x:0,y:0,width:0,height:0}).source,path=document.createElementNS('http://www.w3.org/2000/svg','path');path.classList.add('edge-line','draft');this.edges.append(path);
    const move=ev=>{const p=this.point(ev),curve=edgeCurve({source:start,target:{...p,side:side==='top'?'bottom':side==='bottom'?'top':side==='left'?'right':'left'}});path.setAttribute('d',curve.path);};
    const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);};
    const cancel=()=>{cleanup();path.remove();};
    const up=ev=>{cleanup();path.remove();if(this.api.locked())return;const hit=document.elementFromPoint(ev.clientX,ev.clientY),targetCard=hit?.closest('.sticky'),target=targetCard?.dataset.id;
      if(target&&target!==id){const handle=hit.closest('.handle'),b=this.bounds(target),p=this.point(ev),distances={top:Math.abs(p.y-b.y),right:Math.abs(p.x-b.x-b.width),bottom:Math.abs(p.y-b.y-b.height),left:Math.abs(p.x-b.x)},targetSide=handle?.dataset.side||connectionSides.reduce((best,value)=>distances[value]<distances[best]?value:best,'top');this.api.connect(id,target,side,targetSide);}
      else this.api.connectionStart(id,side);
    };window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});window.addEventListener('pointercancel',cancel,{once:true});move(e);e.preventDefault();e.stopPropagation();
  }
  destroy(){this.abort.abort();}
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, nodeBounds, normalizeContextSize, edgeAnchors, edgeCurve } from '../js/canvas.js';
import { connectionSides } from '../js/domain.js';
import { readFile } from 'node:fs/promises';

function gesture(t, initiallySelected=['a']) {
  const previousWindow=globalThis.window,previousDocument=globalThis.document,previousCSS=globalThis.CSS;
  const handlers=new Map();
  globalThis.window={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name);}};
  globalThis.document={createElement:()=>({style:{},remove(){}})};
  globalThis.CSS={escape:value=>value};
  t.after(()=>{globalThis.window=previousWindow;globalThis.document=previousDocument;globalThis.CSS=previousCSS;});
  let selection=new Set(initiallySelected),details=0,moved=null;
  const nodes=[{id:'a',position:{x:20,y:20}},{id:'b',position:{x:260,y:20}},{id:'hidden',position:{x:500,y:20}}];
  const dom=new Map(nodes.map(n=>[n.id,{style:{left:`${n.position.x}px`,top:`${n.position.y}px`}}]));
  const board=Object.create(Board.prototype);
  board.camera={x:0,y:0,zoom:1};board.grid=false;
  board.api={
    project:()=>({graph:{nodes,edges:[]}}),selection:()=>selection,locked:()=>false,
    select(id,multi){if(multi){if(selection.has(id))selection.delete(id);else selection.add(id);}else selection=new Set(id?[id]:[]);},
    selectMany(ids){selection=new Set(ids);},visible:n=>n.id!=='hidden',showSelection(){details++;},move(positions){moved=positions;}
  };
  board.cards={querySelector:selector=>dom.get(selector.match(/data-id="([^"]+)"/)?.[1])};
  board.coords=id=>{const card=dom.get(id);return {x:parseFloat(card.style.left),y:parseFloat(card.style.top)};};
  board.world={append(){}};board.drawEdges=()=>{};board.point=e=>({x:e.clientX,y:e.clientY});
  return {
    board,handlers,selection:()=>selection,details:()=>details,moved:()=>moved,
    event(id,shift=false,x=0,y=0){const card=id?{dataset:{id}}:null;return {target:{closest:selector=>selector==='.sticky'?card:null},button:0,shiftKey:shift,clientX:x,clientY:y,preventDefault(){}};}
  };
}

test('Shift click adds then removes a card exactly once, retaining other selected cards', t=>{
  const g=gesture(t);
  g.board.down(g.event('b',true));
  g.handlers.get('pointerup')();
  assert.deepEqual([...g.selection()],['a','b']);
  assert.equal(g.details(),1);
  g.board.down(g.event('b',true));
  g.handlers.get('pointerup')();
  assert.deepEqual([...g.selection()],['a']);
  assert.equal(g.details(),2);
});

test('dragging selected cards moves them together and commits one gesture', t=>{
  const g=gesture(t,['a','b']);
  g.board.down(g.event('a',false,10,10));
  g.handlers.get('pointermove')({clientX:50,clientY:30});
  g.handlers.get('pointerup')();
  assert.deepEqual(g.moved(),[{id:'a',x:60,y:40},{id:'b',x:300,y:40}]);
  assert.equal(g.handlers.has('pointermove'),false);
});

test('selection rectangle includes only elements visible through the current filter', t=>{
  const g=gesture(t,[]);
  g.board.down(g.event(null,true,0,0));
  g.handlers.get('pointermove')({clientX:1000,clientY:1000});
  g.handlers.get('pointerup')();
  assert.deepEqual([...g.selection()],['a','b']);
  assert.equal(g.details(),1);
});

test('a read-only board allows inspection without starting a drag or changing positions', t=>{
  const g=gesture(t,[]);
  g.board.api.locked=()=>true;
  g.board.down(g.event('b'));
  assert.deepEqual([...g.selection()],['b']);
  assert.equal(g.handlers.size,0);
  assert.equal(g.moved(),null);
});

test('each explicit side anchors at its own midpoint and curves away from the boundary', ()=>{
  const source={id:'s',position:{x:20,y:30}},target={id:'t',position:{x:500,y:400}};
  const expected={top:{x:125,y:30},right:{x:230,y:103},bottom:{x:125,y:176},left:{x:20,y:103}};
  for(const side of connectionSides){
    const anchors=edgeAnchors({source_side:side,target_side:side},source,target);
    assert.deepEqual(anchors.source,{...expected[side],side});
    assert.equal(anchors.target.side,side);
    const curve=edgeCurve(anchors);assert.ok(curve.path.startsWith(`M${expected[side].x} ${expected[side].y} C`));assert.ok(Number.isFinite(curve.label.x));
  }
});

test('legacy edges infer horizontal or vertical endpoints without rewriting edge data', ()=>{
  const source={position:{x:0,y:0}},edge={id:'e',source:'a',target:'b',relation:'before',label:''},original=structuredClone(edge);
  let anchors=edgeAnchors(edge,source,{position:{x:500,y:0}});assert.equal(anchors.source.side,'right');assert.equal(anchors.target.side,'left');
  anchors=edgeAnchors(edge,source,{position:{x:-500,y:0}});assert.equal(anchors.source.side,'left');assert.equal(anchors.target.side,'right');
  anchors=edgeAnchors(edge,source,{position:{x:0,y:500}});assert.equal(anchors.source.side,'bottom');assert.equal(anchors.target.side,'top');
  anchors=edgeAnchors(edge,source,{position:{x:0,y:-500}});assert.equal(anchors.source.side,'top');assert.equal(anchors.target.side,'bottom');
  assert.deepEqual(edge,original);
});

test('context defaults, inferred members and manual dimensions produce separate stable bounds', ()=>{
  const context={id:'context',kind:'context',name:'Compras',properties:{},position:{x:100,y:80}};
  assert.deepEqual(nodeBounds(context),{x:100,y:80,width:600,height:360});
  const members=[{id:'a',kind:'event',context:'Compras',position:{x:400,y:300}},{id:'b',kind:'event',context:'compras',position:{x:900,y:450}},{id:'out',kind:'event',context:'Outro',position:{x:2000,y:2000}}];
  assert.deepEqual(nodeBounds(context,members),{x:364,y:236,width:782,height:396});
  context.properties={width:820,height:500};assert.deepEqual(nodeBounds(context,members),{x:100,y:80,width:820,height:500});
  const anchors=edgeAnchors({source_side:'right',target_side:'left'},context,members[0],members);assert.deepEqual(anchors.source,{x:920,y:330,side:'right'});
});

test('context resize normalizes invalid, too small and excessive dimensions', ()=>{
  assert.deepEqual(normalizeContextSize(),{width:600,height:360});
  assert.deepEqual(normalizeContextSize({width:30,height:-2}),{width:240,height:180});
  assert.deepEqual(normalizeContextSize({width:Infinity,height:100000}),{width:600,height:10000});
  assert.deepEqual(normalizeContextSize({width:701.5,height:422.2}),{width:702,height:422});
});

test('context resize commits once on release and preserves the starting position', t=>{
  const g=gesture(t,['a']);let resized=null;g.board.graph.nodes[0].kind='context';g.board.graph.nodes[0].properties={width:600,height:360};
  g.board.api.resize=(id,size)=>resized={id,...size};g.board.announce=()=>{};
  const element=g.board.cardElement('a');element.style.width='600px';element.style.height='360px';
  g.board.resize({...g.event('a',false,10,10),stopPropagation(){}},'a');
  g.handlers.get('pointermove')({clientX:110,clientY:70});assert.equal(resized,null);g.handlers.get('pointerup')();
  assert.deepEqual(resized,{id:'a',width:700,height:420});assert.deepEqual(g.board.coords('a'),{x:20,y:20});assert.equal(g.handlers.has('pointermove'),false);assert.equal(g.handlers.has('pointercancel'),false);
});

test('dragging a context freezes its displayed size in the single movement record', t=>{
  const g=gesture(t,['a']);g.board.graph.nodes[0].kind='context';g.board.graph.nodes[0].properties={};g.board.graph.nodes[0].name='Compras';
  g.board.down(g.event('a',false,10,10));g.handlers.get('pointermove')({clientX:50,clientY:30});g.handlers.get('pointerup')();
  assert.deepEqual(g.moved(),[{id:'a',x:60,y:40,width:600,height:360}]);
});

test('context is rendered before edges and ordinary cards with a dotted pointer-transparent interior', async()=>{
  const source=await readFile(new URL('../js/canvas.js',import.meta.url),'utf8'),css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
  assert.ok(source.indexOf('class="contexts"')<source.indexOf('class="connections"'));assert.ok(source.indexOf('class="connections"')<source.indexOf('class="cards"'));
  assert.match(css,/\.contexts\{z-index:0\}/);assert.match(css,/\.world>\.connections\{z-index:1\}/);assert.match(css,/\.cards\{z-index:2\}/);
  assert.match(css,/\.contexts>\.sticky\.context\{[^}]*border:2px dotted[^}]*pointer-events:none/);
});

test('pointer connection preserves every source/target side combination and draft starts on that side', t=>{
  const g=gesture(t,[]),records=[];let latestPath;
  g.board.edges={append(){}};g.board.api.connect=(...values)=>records.push(values);g.board.api.connectionStart=()=>{};
  document.createElementNS=()=>latestPath={classList:{add(){}},attributes:{},setAttribute(name,value){this.attributes[name]=value},remove(){}};
  for(const sourceSide of connectionSides)for(const targetSide of connectionSides){
    const targetCard={dataset:{id:'b'}},targetHandle={dataset:{side:targetSide}};
    document.elementFromPoint=()=>({closest:selector=>selector==='.sticky'?targetCard:selector==='.handle'?targetHandle:null});
    g.board.connect({...g.event('a',false,40,40),stopPropagation(){}},'a',sourceSide);
    const start=edgeAnchors({source_side:sourceSide},g.board.bounds('a'),g.board.bounds('b')).source;
    assert.ok(latestPath.attributes.d.startsWith(`M${start.x} ${start.y} C`));
    g.handlers.get('pointerup')({clientX:270,clientY:30});
    assert.deepEqual(records.at(-1),['a','b',sourceSide,targetSide]);
  }
  assert.equal(records.length,16);assert.equal(g.handlers.has('pointermove'),false);
});

test('keyboard can start connections on all four sides and resize context with arrow keys', t=>{
  const previousCSS=globalThis.CSS;globalThis.CSS={escape:value=>value};t.after(()=>globalThis.CSS=previousCSS);
  const handlers=new Map(),parts=new Map(),announcements={textContent:''},context={id:'ctx',kind:'context',name:'Compras',context:'',position:{x:0,y:0},properties:{width:600,height:360}};
  const dom={style:{left:'0px',top:'0px',width:'600px',height:'360px'},querySelector:()=>({focus(){}})};
  parts.set('.world',{style:{}});parts.set('.cards',{querySelector:()=>null});parts.set('.contexts',{querySelector:()=>dom});parts.set('.edge-group',{innerHTML:''});parts.set('.minimap',{innerHTML:'',addEventListener(){}});parts.set('.empty-canvas',{});parts.set('.board-count',{});parts.set('.zoom-value',{});parts.set('.board-announcement',announcements);
  const el={style:{},classList:{toggle(){}},querySelector:selector=>parts.get(selector),addEventListener(name,handler){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(handler)}};
  const starts=[],resizes=[],api={project:()=>({graph:{nodes:[context],edges:[],viewport:{x:0,y:0,zoom:1}}}),selection:()=>new Set(),visible:()=>true,locked:()=>false,connectionStart:(...args)=>starts.push(args),resize:(id,size)=>{resizes.push({id,...size});Object.assign(context.properties,size);dom.style.width=`${size.width}px`;dom.style.height=`${size.height}px`;}};
  const board=new Board(el,api),keydown=handlers.get('keydown')[0];
  for(const side of connectionSides){const handle={dataset:{side},closest:()=>({dataset:{id:'ctx'}})};keydown({target:{closest:selector=>selector==='.handle'?handle:null},key:'Enter',preventDefault(){},stopPropagation(){}});}
  assert.deepEqual(starts,connectionSides.map(side=>['ctx',side]));
  const resize={closest:()=>({dataset:{id:'ctx'}})},event=(key,shiftKey=false)=>({target:{closest:selector=>selector==='.context-resize'?resize:null},key,shiftKey,preventDefault(){},stopPropagation(){}});
  keydown(event('ArrowRight'));keydown(event('ArrowDown',true));assert.deepEqual(resizes,[{id:'ctx',width:620,height:360},{id:'ctx',width:620,height:460}]);
  assert.match(announcements.textContent,/620 por 460/);board.destroy();
});

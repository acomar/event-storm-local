import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../js/canvas.js';

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

import {httpPresets,newHTTPRequest,normalizeHTTPRequest,normalizeAIHTTP,buildHTTPRequest,executeHTTPRequest,extractHTTPResponse} from './http-request.js';
import {kinds,statuses,relations,origins,newCard,newProject,importProject,validateProject,exampleProject} from './domain.js';
import {questions,extractContent,inspectProject,exportBlueprint} from './facilitator.js';
import {responseSchema,buildMessages,parseFacilitatorResponse,applyFacilitatorPlan,conversationFromProject} from './ai-facilitator.js';
import {LocalStore,VersionEngine,FolderRepositoryAdapter} from './version-control.js';
import {Board,nodeBounds} from './canvas.js';
import {esc,icon,button,iconButton,logo,date,options,download} from './ui.js';

const app=document.querySelector('#app'),modalRoot=document.querySelector('#modal-root');
const store=new LocalStore();
let project=null,engine=null,board=null,panel=null,selected=new Set(),projects=[],search='',filter='all',view='canvas',edgeSelected=null,connectionFrom=null,resolvedReview=null;
let past=[],future=[],queue=Promise.resolve(),saveError='',saving=false,busy=false,revision=0,savedRevision=0;
let aiConfig=null,aiConfigError='',aiLoading=false,aiAbort=null,aiDraft='',aiModel='',aiFailure='',aiLastResult='',aiRemoteConsent=false,aiDraftQueue=Promise.resolve();
let httpDraft=null,httpEditorId='',httpNotice='',httpPreview='',httpResult=null,httpAbort=null,httpDraftQueue=Promise.resolve(),httpTestMessage='O cliente envia um pedido e recebe uma confirmação.';
const titles={http:'Configuração HTTP da IA',properties:'Detalhes do elemento',import:'Importar conteúdo',proposals:'Revisar descobertas',interview:'Facilitador com IA',guided:'Entrevista guiada',sources:'Fontes e evidências',quality:'Qualidade da descoberta',settings:'Configurações do projeto',history:'Histórico',repository:'Compartilhar projeto',conflicts:'Precisamos da sua decisão',edge:'Detalhes da relação'};
const $=(s,r=document)=>r.querySelector(s);
const clone=v=>structuredClone(v);
const filename=()=>project.name.replace(/[^\wÀ-ÿ-]+/g,'-');
const visible=n=>(filter==='all'||n.kind===filter)&&(!search||`${n.name} ${n.description} ${n.context}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
const toast=message=>{const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4000);};
function error(e){saveError=e?.message||String(e);updateStatus();toast(saveError);}
async function run(fn){try{await fn();}catch(e){error(e);} }
const locked=()=>busy||Boolean(engine?.state?.conflictSession);
const storageWarning=()=>store.warning?`<div class="notice storage-warning" role="status">${esc(store.warning)}</div>`:'';
function updateLock(){
  for(const el of document.querySelectorAll('#app input,#app textarea,#app select,#app button,#modal-root input,#modal-root textarea,#modal-root select,#modal-root button')){
    if(['close-panel','theme','ai-cancel','http-cancel'].includes(el.dataset.action))continue;
    const conflictField=Boolean(engine?.state?.conflictSession)&&(el.dataset.field||el.dataset.proposalField||el.dataset.edgeField||el.closest('#extract-form,#ai-form,#version-form'));
    if(busy||conflictField){if(!Object.hasOwn(el.dataset,'busyDisabled'))el.dataset.busyDisabled=String(el.disabled);el.disabled=true;}
    else if(Object.hasOwn(el.dataset,'busyDisabled')){el.disabled=el.dataset.busyDisabled==='true';delete el.dataset.busyDisabled;}
  }
  $('.board')?.setAttribute('aria-busy',String(busy));
}
function setBusy(value){busy=value;updateLock();updateStatus();}
async function exclusive(operation){if(busy)return;setBusy(true);try{await queue;return await operation();}finally{setBusy(false);updateCounts();}}
function updateStatus(){const el=$('#save-status');if(el){el.textContent=saveError?'Não foi possível salvar':saving||revision>savedRevision?'Salvando…':store.backend==='memory'?'Somente nesta sessão · exporte uma cópia':engine?.state?.syncState==='updated'?'Atualizado':'Salvo neste dispositivo';el.classList.toggle('save-error',!!saveError);}const banner=$('#global-error');if(banner){banner.hidden=!saveError;banner.textContent=saveError?`${saveError} Exporte uma cópia antes de fechar, se o salvamento continuar falhando.`:'';} }
function persist(){
  const snapshot=clone(project),currentEngine=engine,r=++revision;saving=true;saveError='';updateStatus();
  queue=queue.catch(()=>{}).then(async()=>{await currentEngine.updateWorkingCopy(snapshot);await store.set(`project:${snapshot.id}`,snapshot);savedRevision=Math.max(savedRevision,r);}).catch(e=>{error(e);throw e;}).finally(()=>{saving=revision>savedRevision;updateStatus();});
  queue.catch(()=>{});return queue;
}
function mutate(fn,{undo=true,redraw=true,refreshPanel=false}={}){
  if(!project||locked())return false;
  const candidate=clone(project);
  try{fn(candidate);candidate.updated_at=new Date().toISOString();validateProject(candidate);}catch(e){error(e);return false;}
  if(undo){past.push(clone(project));if(past.length>50)past.shift();future=[];}
  project=candidate;persist();if(redraw)renderView();if(refreshPanel)renderPanel();updateCounts();return true;
}
function updateCounts(){if(!project)return;const count=$('#pending-count');if(count)count.textContent=project.graph.proposals.filter(p=>p.decision==='pending').length;const counts=$('#footer-count');if(counts)counts.textContent=`${project.graph.nodes.length} elementos · ${project.graph.edges.length} relações`;const u=$('[data-action="undo"]'),r=$('[data-action="redo"]');if(u)u.disabled=locked()||!past.length;if(r)r.disabled=locked()||!future.length;}
function select(id,multi=false,show=true){
  if(connectionFrom&&id&&id!==connectionFrom.id){connect(connectionFrom.id,id,connectionFrom.side);connectionFrom=null;return;}
  if(!id)selected.clear();else if(multi){if(selected.has(id))selected.delete(id);else selected.add(id);}else selected=new Set([id]);
  document.querySelectorAll('.board .sticky').forEach(el=>{const yes=selected.has(el.dataset.id);el.classList.toggle('chosen',yes);el.setAttribute('aria-selected',String(yes));});
  if(id&&show)showPanel('properties');else if(!id&&panel==='properties')renderPanel();
}
function add(kind,position){if(locked())return;const c=newCard(kind,position||{x:100+project.graph.nodes.length%5*245,y:100+Math.floor(project.graph.nodes.length/5)*190});if(!mutate(p=>p.graph.nodes.push(c)))return;selected=new Set([c.id]);showPanel('properties');board?.update();}
function connect(source,target,sourceSide,targetSide){if(locked()||project.graph.edges.some(e=>e.source===source&&e.target===target&&e.relation==='before'&&e.source_side===sourceSide&&e.target_side===targetSide))return;const edge={id:crypto.randomUUID(),source,target,relation:'before',label:''};if(sourceSide)edge.source_side=sourceSide;if(targetSide)edge.target_side=targetSide;if(mutate(p=>p.graph.edges.push(edge)))toast('Relação adicionada. Clique na linha para editar seu significado.');}
function removeSelected(){if(locked())return;const ids=new Set(selected);if(!ids.size)return;mutate(p=>{p.graph.nodes=p.graph.nodes.filter(n=>!ids.has(n.id));p.graph.edges=p.graph.edges.filter(e=>!ids.has(e.source)&&!ids.has(e.target));});selected.clear();renderPanel();}
function duplicate(){if(locked()||!selected.size)return;const nodes=project.graph.nodes.filter(n=>selected.has(n.id)).map(n=>({...clone(n),id:crypto.randomUUID(),position:{x:n.position.x+40,y:n.position.y+40},created_at:new Date().toISOString()}));mutate(p=>p.graph.nodes.push(...nodes));selected=new Set(nodes.map(n=>n.id));board?.update();renderPanel();}
function undo(redo=false){if(locked())return;const from=redo?future:past,to=redo?past:future;if(!from.length)return;to.push(clone(project));project=from.pop();selected=new Set([...selected].filter(id=>project.graph.nodes.some(n=>n.id===id)));persist();renderView();renderPanel();updateCounts();}
async function refresh(){projects=(await store.list('project:')).map(x=>x.value).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));}
async function open(p){await queue.catch(()=>{});aiDraft='';aiFailure='';aiLastResult='';httpDraft=null;httpEditorId='';httpNotice='';httpPreview='';httpResult=null;project=validateProject(p);selected.clear();past=[];future=[];panel=null;filter='all';search='';view='canvas';edgeSelected=null;resolvedReview=null;revision=savedRevision=0;saveError='';engine=new VersionEngine(store,project.id);await engine.init(project);project=clone(engine.state.workingCopy);await restoreAIText();try{const adapter=await FolderRepositoryAdapter.recover(store,project.id,engine.state.repositoryId);if(adapter)await engine.attach(adapter);}catch(e){toast(`A pasta precisa de atenção: ${e.message}`);}if(engine.state.conflictSession)panel='conflicts';renderWorkspace();}
async function create(p){await store.set(`project:${p.id}`,p);await open(p);showPanel(p.graph.nodes.length?'sources':'interview');}
async function back(){await queue;await store.set(`project:${project.id}`,project);project=null;engine=null;board?.destroy();board=null;await refresh();renderHome();}
function theme(){document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('es-local-theme',document.documentElement.dataset.theme);}catch{} }
function renderHome(){
  app.innerHTML=`<div class="dashboard"><header class="home-header">${logo()}<div class="row"><span class="local-badge">${icon('shield',14)} ${store.backend==='memory'?'Sessão temporária':'Workspace no navegador'}</span>${iconButton('theme','Alternar tema','moon')}</div></header><main class="home-content">${storageWarning()}<section class="welcome"><div><p class="eyebrow">SEU ESPAÇO DE DESCOBERTA</p><h1>Antes da solução,<br>entenda a história.</h1><p>Conecte acontecimentos, revele dúvidas e construa<br class="desktop"> um entendimento compartilhado do negócio.</p></div><div class="mini-map-art" aria-hidden="true"><div class="art-card yellow">Quem participa?</div><div class="art-line"></div><div class="art-card orange">O que aconteceu?</div><div class="art-card pink">O que falta saber?</div></div></section><section class="start-grid"><button class="start-card" data-action="new-text"><span class="start-icon blue">${icon('text',24)}</span><h2>Importar conteúdo</h2><p>Comece com uma descrição,<br>um arquivo TXT ou Markdown.</p><span class="card-action">Encontrar os primeiros eventos ${icon('arrow')}</span></button><button class="start-card" data-action="new"><span class="start-icon orange">${icon('map',24)}</span><h2>Começar do zero</h2><p>Explore livremente ou siga<br>uma entrevista com o facilitador.</p><span class="card-action">Criar um mapa ${icon('plus')}</span></button><button class="start-card" data-action="import-json"><span class="start-icon green">${icon('history',24)}</span><h2>Retomar uma descoberta</h2><p>Abra um projeto exportado<br>ou um pacote com seu histórico.</p><span class="card-action">Importar projeto ${icon('upload')}</span></button></section><div class="projects-heading"><h2>Seus projetos <span>${projects.length}</span></h2>${button('import-json','Importar JSON','upload')}</div>${projects.length?`<div class="project-grid">${projects.map(p=>`<button class="project-card" data-action="open" data-id="${esc(p.id)}"><span class="project-glyph">${icon('map',24)}</span><h3>${esc(p.name)}</h3><p>${esc(p.objective||'Exploração de domínio')}</p><div>${icon('clock',13)} ${date(p.updated_at)}<span>${p.graph.nodes.length} elementos</span></div></button>`).join('')}</div>`:`<div class="empty-home">${icon('text',28)}<div><h3>Seu primeiro mapa começa com uma conversa.</h3><p>Crie um projeto ou explore o exemplo editável de abertura de conta.</p></div></div>`}<button class="example-strip" data-action="example"><span class="example-icon">${icon('layers',26)}</span><span><strong>Explore um exemplo completo</strong><small>Abertura de conta: eventos, políticas, sistemas e uma pergunta em aberto.</small></span><span class="example-action">Abrir exemplo ${icon('arrow')}</span></button><footer class="home-footer">Conhecimento rastreável. Decisões humanas.<span>Local-first · IA conectada ao seu modelo</span></footer></main></div>`;
}
function renderWorkspace(){
  board?.destroy();board=null;
  app.innerHTML=`<div class="studio"><header class="studio-header">${iconButton('back','Voltar aos projetos','back')}${logo()}<span class="header-divider"></span><button class="project-title" data-action="settings">${esc(project.name)}</button><span id="save-status" class="save-status" role="status"></span><div class="header-tools">${iconButton('theme','Alternar tema','moon')}${iconButton('history','Histórico','history')}${button('sync','Sincronizar','folder')}${button('export-json','Exportar JSON','download')}</div></header><div id="global-error" class="error error-bar" role="alert" hidden></div>${storageWarning()}<div class="workspace"><aside class="left-panel"><div class="workspace-label"><span class="project-avatar">${esc(project.name.slice(0,1).toUpperCase())}</span><div><strong>Workspace</strong><small>Descoberta de domínio</small></div></div><nav>${nav('import','Importar conteúdo','upload')}${nav('interview','Facilitador com IA','chat')}${nav('http','Configurar IA','settings')}${nav('guided','Entrevista guiada','list')}${nav('proposals','Revisar descobertas','bulb',`<span class="count" id="pending-count">0</span>`)}${nav('sources','Fontes e evidências','text')}${nav('quality','Qualidade da descoberta','shield')}${nav('history','Histórico','history')}${nav('repository','Compartilhar projeto','folder')}</nav><div class="library-heading">BIBLIOTECA <span>Arraste ou clique</span></div><div class="elements">${Object.entries(kinds).map(([k,v])=>`<button type="button" data-action="add" data-kind="${k}" draggable="true" title="${esc(v.hint)}"><span class="kind-dot" style="background:${v.color}"></span><span>${esc(v.label)}</span>${icon('plus',13)}</button>`).join('')}</div><div class="left-tip">${icon('bulb',16)}<p>O mapa é uma conversa.<br>Hipóteses pedem validação.</p></div></aside><main class="canvas-area"><div class="canvas-toolbar"><select id="modality" aria-label="Profundidade do workshop"><option value="big_picture">Big Picture</option><option value="process">Process Level</option><option value="design">Software Design</option></select><div class="view-switch">${iconButton('canvas-view','Visualizar mapa','grid',`aria-pressed="${view==='canvas'}"`)}${iconButton('list-view','Visualizar lista','list',`aria-pressed="${view==='list'}"`)}</div><div class="search-box">${icon('search',16)}<input id="search" aria-label="Buscar no mapa" placeholder="Buscar no mapa" value="${esc(search)}"></div><select id="filter" aria-label="Filtrar por tipo"><option value="all">Todos os tipos</option>${options(kinds,filter)}</select><div class="toolbar-history">${iconButton('undo','Desfazer','undo')}${iconButton('redo','Refazer','redo')}</div></div><div id="view-root"></div><footer class="canvas-footer"><span>${icon('shield',12)} ${store.backend==='memory'?'Nesta sessão':'Local-first'} · <span id="footer-count"></span></span><span>Shift: selecionar · arrastar: mover · roda: zoom · pontos: conectar</span></footer></main><div id="panel-root"></div></div></div>`;
  $('#modality').value=project.modality;renderView();renderPanel();updateCounts();updateStatus();updateLock();
}
const nav=(action,label,ico,extra='')=>`<button type="button" data-action="${action}" title="${label}">${icon(ico,17)}<span>${label}</span>${extra}</button>`;
function renderView(){
  if(!project)return;const root=$('#view-root');if(!root)return;
  if(view==='list'){board?.destroy();board=null;root.innerHTML=`<div class="list-view">${project.graph.nodes.filter(visible).map(n=>`<button type="button" data-action="select" data-id="${esc(n.id)}"><span class="type-badge" style="background:${kinds[n.kind].color}">${esc(kinds[n.kind].label)}</span><span><strong>${esc(n.name)}</strong><small>${esc(n.description||n.context||'Sem descrição')}</small></span><span>${esc(statuses[n.status])}</span></button>`).join('')||'<p class="helper">Nenhum elemento corresponde à busca.</p>'}</div>`;}
  else if(board)board.update();else{root.innerHTML='<div class="board"></div>';board=new Board($('.board',root),{project:()=>project,selection:()=>selected,locked,showSelection:()=>showPanel('properties'),visible,select,selectMany:ids=>{selected=new Set(ids);board?.update();},add,connect,viewport:v=>mutate(p=>p.graph.viewport=v,{undo:false,redraw:false}),rename:(id,name)=>mutate(p=>{const n=p.graph.nodes.find(n=>n.id===id);n.name=name;n.updated_at=new Date().toISOString();},{refreshPanel:true}),move:positions=>mutate(p=>{for(const pos of positions){const n=p.graph.nodes.find(n=>n.id===pos.id);if(n){n.position={x:pos.x,y:pos.y};if(n.kind==='context'&&pos.width!==undefined){n.properties.width=pos.width;n.properties.height=pos.height;}}}}),resize:(id,size)=>mutate(p=>{const n=p.graph.nodes.find(n=>n.id===id);if(n?.kind==='context'){const bounds=nodeBounds(n,p.graph.nodes);n.position={x:bounds.x,y:bounds.y};n.properties.width=size.width;n.properties.height=size.height;}}),connectionStart:(id,side)=>{if(locked())return;if(connectionFrom&&connectionFrom.id!==id){connect(connectionFrom.id,id,connectionFrom.side,side);connectionFrom=null;}else{connectionFrom={id,side};toast('Ative um ponto de conexão no cartão de destino.');}},edge:id=>{edgeSelected=id;showPanel('edge');},menu:contextMenu});}
}
function showPanel(name){if(name==='http'){run(openHTTPSettings);return;}panel=name;renderPanel();if(name==='interview'&&!activeHTTPRequest()&&!aiConfig&&!aiLoading)loadAIConfig();}
function renderPanel(){
  if(!project)return;const root=$('#panel-root');if(!root)return;document.querySelectorAll('.left-panel nav button').forEach(el=>el.classList.toggle('active',el.dataset.action===panel));
  if(!panel){root.innerHTML='';return;}
  root.innerHTML=`<aside class="detail-panel ${panel==='interview'?'ai-panel':panel==='http'?'http-panel':''}"><div class="panel-head"><h2>${titles[panel]}</h2>${iconButton('close-panel','Fechar painel','close')}</div><div class="panel-body" id="panel-body"></div></aside>`;
  const body=$('#panel-body');if(panel==='properties')body.innerHTML=properties();if(panel==='import')body.innerHTML=importPanel();if(panel==='proposals')body.innerHTML=proposalsPanel();if(panel==='interview')body.innerHTML=aiPanel();if(panel==='guided')body.innerHTML=guidedPanel();if(panel==='http')body.innerHTML=httpPanel();if(panel==='sources')body.innerHTML=sourcesPanel();if(panel==='quality')body.innerHTML=qualityPanel();if(panel==='settings')body.innerHTML=settingsPanel();if(panel==='repository')body.innerHTML=repositoryPanel();if(panel==='edge')body.innerHTML=edgePanel();if(panel==='conflicts')body.innerHTML=conflictPanel();if(panel==='history')run(async()=>{const entries=await engine.history();if(panel==='history'){body.innerHTML=historyPanel(entries);updateLock();}});updateLock();
}
function activeHTTPRequest(){return project?.ai_http?.requests.find(r=>r.id===project.ai_http.active_id)||null;}
function httpVariables(p,messages,message){
  return {messages,message,schema:responseSchema,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n'),history:messages.slice(0,-1),prompt:messages.map(m=>m.role.toUpperCase()+':\n'+m.content).join('\n\n'),project:{id:p.id,name:p.name,objective:p.objective,modality:p.modality}};
}
function httpSample(){const p=newProject('Teste da requisição HTTP'),message=httpTestMessage.trim()||'O cliente envia um pedido e recebe uma confirmação.';return {project:p,message,variables:httpVariables(p,buildMessages(p,[],message),message)};}
function selectedHTTPRequest(){return httpDraft?.requests.find(r=>r.id===httpEditorId)||httpDraft?.requests[0]||null;}
async function saveHTTPDraft(){
  if(!project||!httpDraft)return;const key='ai-http-editor:'+project.id+':'+store.sessionId,value={config:clone(httpDraft),selected:httpEditorId};
  httpDraftQueue=httpDraftQueue.catch(()=>{}).then(()=>store.set(key,value));return httpDraftQueue;
}
async function openHTTPSettings(){
  const id=project.id;await httpDraftQueue.catch(()=>{});
  if(!httpDraft){
    const key='ai-http-editor:'+id+':';let saved=await store.get(key+store.sessionId);if(saved===undefined&&store.recoverySessionId)saved=await store.get(key+store.recoverySessionId);
    if(!project||project.id!==id)return;
    if(saved?.config&&Array.isArray(saved.config.requests)){httpDraft=clone(saved.config);httpEditorId=saved.selected;}
    else if(project.ai_http){httpDraft=clone(project.ai_http);httpEditorId=httpDraft.active_id;}
    else{const request=newHTTPRequest('ollama');if(aiConfig){request.url=aiConfig.baseURL+'/chat/completions';request.parameters.find(p=>p.name==='model').value=aiModel||aiConfig.model;request.name='Conexão do facilitador';}httpDraft={active_id:request.id,requests:[request]};httpEditorId=request.id;}
  }
  if(!selectedHTTPRequest())httpEditorId=httpDraft.requests[0]?.id||'';
  panel='http';renderPanel();
}
function httpField(label,key,value,{type='text',options:values,rows=5,placeholder=''}={}){
  const attributes=' data-http-field="'+esc(key)+'"';
  let control;
  if(values)control='<select'+attributes+'>'+Object.entries(values).map(([key,label])=>'<option value="'+esc(key)+'"'+(key===value?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
  else if(type==='textarea')control='<textarea'+attributes+' rows="'+rows+'" maxlength="60000" spellcheck="false">'+esc(value)+'</textarea>';
  else control='<input'+attributes+' type="'+type+'" value="'+esc(value)+'"'+(type==='number'?' min="50" max="300000" step="50"':'')+' placeholder="'+esc(placeholder)+'">';
  return '<label>'+esc(label)+control+'</label>';
}
function httpRows(kind,profile){
  const labels={parameters:['variável','Variáveis'],headers:['cabeçalho','Cabeçalhos'],query:['parâmetro da URL','Parâmetros da URL']};
  const row=labels[kind][0],article=kind==='parameters'?'da ':'do ';
  return '<div class="http-rows">'+profile[kind].map((item,index)=>{
    const data=' data-http-row="'+kind+'" data-index="'+index+'"';
    return '<div class="http-row"><input type="checkbox" aria-label="Ativar '+row+' '+(index+1)+'"'+data+' data-key="enabled"'+(item.enabled?' checked':'')+'><div><input aria-label="Nome '+article+row+' '+(index+1)+'"'+data+' data-key="name" placeholder="Nome" value="'+esc(item.name)+'"><input aria-label="Valor '+article+row+' '+(index+1)+'"'+data+' data-key="value" placeholder="Valor ou {{variável}}" value="'+esc(item.value)+'"></div>'+(kind==='parameters'?'<select aria-label="Tipo da variável '+(index+1)+'"'+data+' data-key="type"><option value="text"'+(item.type==='text'?' selected':'')+'>Texto</option><option value="json"'+(item.type==='json'?' selected':'')+'>JSON</option></select>':'')+iconButton('http-remove-row','Remover '+row+' '+(index+1),'close','data-group="'+kind+'" data-index="'+index+'"')+'</div>';
  }).join('')+'</div>'+button('http-add-row','Adicionar '+row,'plus','secondary','data-group="'+kind+'"');
}
function httpPanel(){
  if(!httpDraft)return '<p class="helper">Carregando configurações…</p>';
  const r=selectedHTTPRequest(),active=activeHTTPRequest();
  const profiles='<label>Requisições cadastradas<select id="http-profile">'+httpDraft.requests.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===r?.id?' selected':'')+'>'+esc(p.name)+(p.id===active?.id?' · ativa':'')+'</option>').join('')+'</select></label>';
  const controls='<div class="button-row">'+button('http-new','Nova requisição','plus')+(r?button('http-duplicate','Duplicar','copy')+button('http-remove','Remover','trash','secondary danger'):'')+'</div>';
  if(!r)return '<p class="intro">Cadastre a requisição HTTP que o facilitador deve usar.</p>'+controls+button('http-use','Salvar configuração','check','primary full');
  let auth='';
  if(r.auth.type==='bearer'||r.auth.type==='header')auth+=httpField('Token ou chave','auth.token',r.auth.token,{placeholder:'{{apiKey}}'});
  if(r.auth.type==='header')auth+=httpField('Nome do cabeçalho de autenticação','auth.header',r.auth.header);
  if(r.auth.type==='basic')auth+=httpField('Usuário HTTP','auth.username',r.auth.username)+httpField('Senha HTTP','auth.password',r.auth.password,{type:'password'});
  const body=r.body_type==='none'?'<p class="helper">Esta requisição não envia corpo.</p>':httpField('Corpo da requisição','body',r.body,{type:'textarea',rows:11});
  return '<p class="intro">Configure uma requisição e escolha o que será enviado ao modelo.</p><p class="helper">Salvar e usar guarda a configuração no navegador e no projeto. Cabeçalhos, chaves e variáveis também acompanham os arquivos exportados e as versões.</p>'+profiles+controls+
    '<div class="http-toolbar">'+button('http-use','Salvar e usar','check','primary')+button('http-test','Testar requisição','arrow')+button('interview','Voltar ao facilitador','chat')+'</div>'+
    '<div data-http-notice class="notice" role="status"'+(httpNotice?'':' hidden')+'>'+esc(httpNotice)+'</div>'+
    '<label>Usar um modelo de requisição<select id="http-preset"><option value="">Escolha para preencher os campos…</option>'+Object.entries(httpPresets).map(([id,name])=>'<option value="'+id+'">'+esc(name)+'</option>').join('')+'</select></label>'+
    httpField('Nome da requisição','name',r.name)+
    '<div class="http-address">'+httpField('Método HTTP','method',r.method,{options:{GET:'GET',POST:'POST',PUT:'PUT',PATCH:'PATCH',DELETE:'DELETE',HEAD:'HEAD',OPTIONS:'OPTIONS'}})+httpField('URL do endpoint','url',r.url,{placeholder:'https://seu-provedor/v1/chat/completions'})+'</div>'+
    '<div class="http-split">'+httpField('Executar por','execution',r.execution,{options:{bridge:'Servidor local',browser:'Direto no navegador'}})+httpField('Tempo limite (ms)','timeout_ms',r.timeout_ms,{type:'number'})+'</div>'+
    '<p class="helper">O servidor local encaminha a requisição. A execução direta também funciona no HTML único quando o endpoint permite CORS.</p>'+
    '<details class="http-section" open><summary>Variáveis reutilizáveis</summary>'+httpRows('parameters',r)+'<p class="helper">Use {{model}}, {{apiKey}} ou outra variável nos campos. Variáveis JSON preservam números, listas e objetos.</p></details>'+
    '<details class="http-section"><summary>Autenticação</summary>'+httpField('Tipo de autenticação','auth.type',r.auth.type,{options:{none:'Sem autenticação',bearer:'Bearer token',basic:'Basic auth',header:'Chave em cabeçalho'}})+auth+'</details>'+
    '<details class="http-section"><summary>Cabeçalhos · '+r.headers.length+'</summary>'+httpRows('headers',r)+'</details>'+
    '<details class="http-section"><summary>Parâmetros da URL · '+r.query.length+'</summary>'+httpRows('query',r)+'</details>'+
    '<details class="http-section" open><summary>Corpo</summary>'+httpField('Formato do corpo','body_type',r.body_type,{options:{none:'Sem corpo',json:'JSON',text:'Texto',form:'Form URLencoded'}})+body+'<p class="helper">No JSON, escreva "{{messages}}" e "{{schema}}" entre aspas: esses valores são substituídos pelas listas e objetos reais. Também estão disponíveis {{prompt}}, {{message}}, {{system}}, {{history}} e {{project.name}}.</p></details>'+
    httpField('Campo da resposta que contém o texto','response_path',r.response_path,{placeholder:'choices[0].message.content'})+'<p class="helper">Deixe vazio para usar a resposta inteira, ou indique um campo, como output ou choices[0].message.content.</p>'+
    '<label>Mensagem para teste<textarea id="http-test-message" maxlength="30000" rows="3">'+esc(httpTestMessage)+'</textarea></label><p class="helper">O teste usa um mapa vazio e esta mensagem. O mapa do seu projeto é enviado apenas ao conversar com o facilitador.</p>'+
    '<div class="button-row">'+button('http-preview','Ver requisição preenchida','text')+button('http-export','Exportar configuração','download')+'</div><label>Importar configuração JSON<input id="http-config-file" type="file" accept=".json,application/json"></label>'+
    (httpAbort?'<div class="notice" role="status">Executando requisição…</div>'+button('http-cancel','Cancelar teste','close'):'')+
    (httpPreview?'<details class="http-output" open><summary>Requisição preenchida</summary><pre>'+esc(httpPreview)+'</pre></details>':'')+
    (httpResult?'<section class="http-output" aria-label="Resultado do teste HTTP"><h3>'+esc(httpResult.title)+'</h3><p class="helper">'+esc(httpResult.note)+'</p>'+(httpResult.body?'<details open><summary>Resposta</summary><pre>'+esc(httpResult.body)+'</pre></details>':'')+(httpResult.headers?'<details><summary>Cabeçalhos da resposta</summary><pre>'+esc(httpResult.headers)+'</pre></details>':'')+'</section>':'');
}
function editHTTPField(el){
  const r=selectedHTTPRequest();if(!r)return;
  if(el.dataset.httpRow){const row=r[el.dataset.httpRow][Number(el.dataset.index)];if(row)row[el.dataset.key]=el.dataset.key==='enabled'?el.checked:el.value;}
  else{const key=el.dataset.httpField;if(key.startsWith('auth.'))r.auth[key.slice(5)]=el.value;else r[key]=key==='timeout_ms'?Number(el.value):el.value;}
  httpNotice='Alterações no editor. Clique em Salvar e usar para atualizar o projeto.';httpPreview='';httpResult=null;
  const note=$('[data-http-notice]');if(note){note.hidden=false;note.textContent=httpNotice;}
  saveHTTPDraft().catch(()=>toast('Não foi possível preservar o rascunho da configuração.'));
}
async function testHTTPRequest(){
  if(busy)return;httpResult=null;httpPreview='';httpNotice='';
  const profile=normalizeHTTPRequest(selectedHTTPRequest()),sample=httpSample(),controller=new AbortController();httpAbort=controller;
  await exclusive(async()=>{
    renderPanel();
    try{
      const result=await executeHTTPRequest(profile,sample.variables,{signal:controller.signal});
      let note=result.status>=200&&result.status<300?'Conexão executada.':'O endpoint respondeu com erro HTTP; confira o corpo abaixo.';
      if(result.status>=200&&result.status<300){
        try{parseFacilitatorResponse(extractHTTPResponse(result,profile.response_path),sample.project,[],sample.message);note+=' O formato do facilitador foi reconhecido.';}
        catch(error){note+=' O retorno ainda precisa de ajuste para o facilitador: '+error.message;}
      }
      httpResult={title:'HTTP '+result.status+' · '+result.duration_ms+' ms',note,body:result.body.slice(0,18000)+(result.body.length>18000?'\n… resposta truncada na prévia.':''),headers:JSON.stringify(result.headers,null,2)};
    }catch(error){httpResult={title:controller.signal.aborted?'Teste cancelado':'Falha na requisição',note:error.message};}
    finally{httpAbort=null;}
  });if(panel==='http')renderPanel();
}
async function httpAction(action,el){
  if(action==='http-cancel'){httpAbort?.abort('cancelled');return;}if(busy)return;
  if(action==='http-test'){await testHTTPRequest();return;}
  if(action==='http-new'||action==='http-duplicate'){
    if(httpDraft.requests.length>=20)throw Error('Cadastre até 20 requisições.');
    const r=action==='http-new'?newHTTPRequest('custom'):clone(selectedHTTPRequest());if(action==='http-duplicate'){r.id=crypto.randomUUID();r.name=(r.name+' · cópia').slice(0,120);}
    httpDraft.requests.push(r);httpEditorId=r.id;
  }
  if(action==='http-remove'){httpDraft.requests=httpDraft.requests.filter(r=>r.id!==httpEditorId);httpEditorId=httpDraft.requests[0]?.id||'';if(!httpDraft.requests.some(r=>r.id===httpDraft.active_id))httpDraft.active_id=httpEditorId;}
  if(action==='http-add-row'){const kind=el.dataset.group,r=selectedHTTPRequest();if(r[kind].length>=30)throw Error('Use até 30 linhas.');r[kind].push({name:'',value:'',enabled:true,...(kind==='parameters'?{type:'text'}:{})});}
  if(action==='http-remove-row')selectedHTTPRequest()[el.dataset.group].splice(Number(el.dataset.index),1);
  if(action==='http-preview'){httpPreview=JSON.stringify(buildHTTPRequest(selectedHTTPRequest(),httpSample().variables),null,2);httpResult=null;renderPanel();return;}
  if(action==='http-export'){const config=normalizeAIHTTP({...httpDraft,active_id:httpEditorId});download({format:'event-storm-local-http',version:1,ai_http:config},filename()+'-http.json');return;}
  if(action==='http-use'){
    if(locked()){toast('Resolva as diferenças antes de salvar a configuração.');return;}
    const config=normalizeAIHTTP({...httpDraft,active_id:httpEditorId});
    if(!mutate(p=>{p.ai_http=config;},{redraw:false}))return;await queue;
    httpDraft=clone(config);httpNotice='Configuração salva no navegador e no projeto. '+(config.active_id?'Esta é a requisição ativa do facilitador.':'Nenhuma requisição está ativa.');await saveHTTPDraft();renderPanel();return;
  }
  httpPreview='';httpResult=null;await saveHTTPDraft();renderPanel();
}
async function loadAIConfig(){
  if(aiLoading)return;aiLoading=true;aiConfigError='';if(panel==='interview')renderPanel();
  try{
    if(!['http:','https:'].includes(location.protocol))throw Error('Abra a aplicação com npm start para conectar um modelo. O arquivo único continua disponível para editar o mapa e usar a entrevista guiada.');
    const response=await fetch('./api/ai/config',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('O servidor de IA não está disponível nesta origem. Inicie a aplicação com npm start e configure seu modelo local.');
    const config=await response.json();if(config?.configured===false)throw Error(config.error?.message||'O servidor de IA precisa de uma configuração válida.');if(!config||!['local','remote'].includes(config.mode)||typeof config.model!=='string'||typeof config.baseURL!=='string')throw Error('Configuração do facilitador inválida. Confira o servidor local.');
    aiConfig=config;if(!aiModel)aiModel=config.model;
  }catch(e){aiConfig=null;aiConfigError=e.name==='TimeoutError'?'O servidor local demorou para responder. Verifique se a aplicação está aberta com npm start.':e.message;}
  finally{aiLoading=false;if(panel==='interview')renderPanel();}
}
function saveAIText(){
  if(!project)return Promise.resolve();const key=`ai-draft:${project.id}:${store.sessionId}`,value=aiDraft;
  aiDraftQueue=aiDraftQueue.catch(()=>{}).then(()=>store.set(key,value));return aiDraftQueue;
}
async function restoreAIText(){
  await aiDraftQueue.catch(()=>{});const key=`ai-draft:${project.id}:`;
  let value=await store.get(key+store.sessionId);if(value===undefined&&store.recoverySessionId)value=await store.get(key+store.recoverySessionId);
  aiDraft=typeof value==='string'?value:'';if(aiDraft)await saveAIText();
}
function aiMessageText(message){const suffix='\n\n'+message.question;return message.role==='assistant'&&message.question&&message.content.endsWith(suffix)?message.content.slice(0,-suffix.length):message.content;}
function aiPanel(){
  const conversation=conversationFromProject(project),last=conversation.filter(m=>m.role==='assistant').at(-1),profile=activeHTTPRequest();
  const remote=!profile&&aiConfig?.mode==='remote',ready=Boolean(profile||aiConfig)&&!engine.state.conflictSession;
  const connection=profile?'HTTP · '+esc(profile.name):aiLoading?'Verificando configuração…':aiConfig?'Conexão do servidor · '+esc(aiConfig.model):'Configure sua requisição HTTP';
  let settings='';
  if(profile)settings='<details class="ai-settings"><summary>Requisição ativa</summary><p class="helper">'+esc(profile.method+' '+profile.url)+'</p><p class="helper">'+(profile.execution==='browser'?'Execução direta no navegador':'Encaminhada pelo servidor local')+'</p></details>';
  else if(aiConfig)settings='<details class="ai-settings"><summary>Configuração anterior do servidor</summary><p class="helper">'+esc(aiConfig.baseURL)+'</p><label>Nome do modelo<input id="ai-model" value="'+esc(aiModel)+'" maxlength="120"></label>'+(remote?'<label class="check-row"><input id="ai-consent" type="checkbox" '+(aiRemoteConsent?'checked':'')+'>Autorizo enviar a conversa, o mapa e suas fontes a esse serviço externo nesta sessão.</label>':'')+'</details>';
  const chat=conversation.map(m=>'<article class="ai-message '+(m.role==='user'?'ai-user':'ai-assistant')+'"><strong>'+(m.role==='user'?'Você':'Facilitador')+'</strong><p>'+esc(aiMessageText(m))+'</p>'+(m.role==='assistant'&&m.summary?'<div class="ai-summary">'+esc(m.summary)+'</div>':'')+(m.role==='assistant'&&m.question?'<div class="ai-question">'+esc(m.question)+'</div>':'')+'</article>').join('');
  return '<div class="facilitator-label"><span class="facilitator-avatar">E</span><div><strong>Crítico. Direto. Orientado a evidências.</strong><p>'+connection+'</p></div></div>'+
    '<p class="helper">Traga qualquer contexto, processo ou texto. Vou desenhar o fluxo conforme a conversa, questionar contradições e mostrar o que falta saber. Novos elementos entram como hipóteses; alterações em cartões existentes viram propostas.</p>'+
    (!profile&&aiConfigError?'<div class="error" role="alert">'+esc(aiConfigError)+'</div>':'')+settings+
    '<div class="button-row">'+button('http','Configurar HTTP','settings')+(!profile?button('ai-reconnect','Atualizar conexão anterior','settings'):'')+button('guided','Roteiro de perguntas','list')+'</div>'+
    '<div class="ai-conversation" role="log" aria-label="Conversa com o facilitador">'+(chat||'<div class="current-question">O que acontece nesse domínio? Cole o contexto que você já tem. Vou montar uma primeira narrativa e apontar a pergunta que mais destrava o fluxo.</div>')+'</div>'+
    (aiLastResult?'<p class="notice" role="status">'+esc(aiLastResult)+'</p>':'')+(aiFailure?'<div class="error" role="alert">'+esc(aiFailure)+'</div>':'')+
    (busy&&aiAbort?'<div class="notice" role="status">O facilitador está analisando o contexto e o mapa…</div>'+button('ai-cancel','Cancelar análise','close','secondary full'):'')+
    '<form id="ai-form"><label>'+(last?.question?'Sua resposta ou novo contexto':'Contexto ou mensagem')+'<textarea name="message" id="ai-message" maxlength="30000" rows="6" required placeholder="O cliente faz o pedido. Quando o pagamento é aprovado…">'+esc(aiDraft)+'</textarea></label><label>Adicionar TXT / Markdown<input id="ai-file" type="file" accept=".txt,.md,text/plain,text/markdown"></label><button class="primary full" '+(!ready||busy?'disabled':'')+'>'+icon('send')+' Conversar e atualizar o mapa</button></form>'+
    '<p class="helper">Até 30 mil caracteres por mensagem. A conversa usa a requisição ativa; o resultado e suas evidências ficam no histórico local.</p>';
}
async function sendAI(form){
  if(locked())return;const profile=activeHTTPRequest();if(!profile&&!aiConfig){await loadAIConfig();return;}
  const message=form.elements.message.value.trim();if(!message)return;
  if(!profile&&aiConfig.mode==='remote'&&!$('#ai-consent')?.checked){aiFailure='Autorize o envio ao serviço externo ou configure um modelo local antes de conversar.';renderPanel();return;}
  aiDraft=message;aiFailure='';aiLastResult='';const snapshot=clone(project),conversation=conversationFromProject(snapshot);let applied=false,fitAfter=false;
  const controller=new AbortController();aiAbort=controller;const timer=setTimeout(()=>controller.abort('timeout'),profile?profile.timeout_ms+5000:130000);
  await exclusive(async()=>{
    renderPanel();
    try{
      await saveAIText();
      const messages=buildMessages(snapshot,conversation,message);let content;
      if(profile){
        const result=await executeHTTPRequest(profile,httpVariables(snapshot,messages,message),{signal:controller.signal});
        if(result.status<200||result.status>=300)throw Error('O endpoint retornou HTTP '+result.status+'. '+result.body.slice(0,300));
        content=extractHTTPResponse(result,profile.response_path);
      }else{
        const response=await fetch('./api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages,model:aiModel||aiConfig.model,schema:responseSchema}),signal:controller.signal});
        const result=await response.json().catch(()=>null);
        if(!response.ok)throw Error(result?.error?.message||'Não foi possível consultar o modelo. Verifique a conexão configurada.');
        if(!result||typeof result.content!=='string')throw Error('O modelo retornou uma resposta sem conteúdo válido. Nenhum elemento foi alterado.');
        content=result.content;
      }
      const plan=parseFacilitatorResponse(content,snapshot,conversation,message),candidate=validateProject(applyFacilitatorPlan(snapshot,plan));
      past.push(clone(project));if(past.length>50)past.shift();future=[];project=candidate;applied=true;
      const added=project.graph.nodes.length-snapshot.graph.nodes.length,edges=project.graph.edges.length-snapshot.graph.edges.length,proposals=project.graph.proposals.length-snapshot.graph.proposals.length;
      aiLastResult=[`${added} elemento${added===1?'':'s'} e ${edges} ${edges===1?'relação':'relações'} acrescentados ao mapa.`,proposals?`${proposals} ${proposals===1?'alteração aguarda':'alterações aguardam'} revisão.`:'',...(plan.warnings||[])].filter(Boolean).join(' ');
      await persist();aiDraft='';await saveAIText();renderView();fitAfter=!snapshot.graph.nodes.length&&added>0;
    }catch(e){if(applied)renderView();aiFailure=applied?'O mapa foi atualizado, mas o salvamento falhou. Exporte uma cópia antes de fechar.':controller.signal.aborted?(controller.signal.reason==='timeout'?'O modelo excedeu o tempo de resposta. Sua mensagem foi preservada; tente um modelo menor ou novamente.':'Análise cancelada. Sua mensagem foi preservada.'):`${e.message} Sua mensagem foi preservada.`;}
    finally{clearTimeout(timer);aiAbort=null;}
  });
  if(fitAfter)board?.fit();if(panel==='interview')renderPanel();
}
function field(label,key,value,type='input',extra=''){
  const attributes=`data-field="${esc(key)}" ${extra}`;
  const control=type==='input'?`<input value="${esc(value)}" ${attributes}>`:type==='textarea'?`<textarea ${attributes}>${esc(value)}</textarea>`:`<select ${attributes}>${value}</select>`;
  return `<label>${esc(label)}${control}</label>`;
}
function properties(){
  const n=project.graph.nodes.find(n=>selected.has(n.id));if(!n)return '<div class="empty-panel"><h3>Selecione um elemento</h3><p>Veja seu significado, suas fontes e o que ainda precisa ser validado.</p></div>';
  return `<span class="type-badge" style="background:${kinds[n.kind].color}">${esc(kinds[n.kind].label)}</span>${field('Nome','name',n.name,'input','maxlength="240"')}<p class="helper">${esc(kinds[n.kind].hint)}</p>${field('Tipo','kind',options(kinds,n.kind),'select')}${field('Estado do conhecimento','status',options(statuses,n.status),'select')}${field('Descrição','description',n.description,'textarea','maxlength="4000" rows="4"')}${field('Contexto','context',n.context,'input','maxlength="240"')}${field('Autor','author',n.author,'input','maxlength="160"')}${n.kind==='context'?`${field('Largura da área','properties.width',nodeBounds(n,project.graph.nodes).width,'input','type="number" min="240" max="10000" step="20"')}${field('Altura da área','properties.height',nodeBounds(n,project.graph.nodes).height,'input','type="number" min="180" max="10000" step="20"')}<p class="helper">O contorno fica atrás dos componentes. Arraste o título para mover e use o canto para redimensionar.</p>`:''}${n.kind==='event'?`<label class="check-row"><input type="checkbox" data-field="pivotal" ${n.properties.pivotal?'checked':''}>Evento central</label>`:''}<div class="section-title">Procedência</div><p class="helper">${esc(origins[n.origin])} · ${date(n.created_at)}</p>${n.evidence_ids.map(id=>evidenceHtml(id)).join('')||'<p class="helper">Registro manual. Descreva a origem da informação e valide com um especialista.</p>'}<div class="section-title">Relações</div>${project.graph.edges.filter(e=>e.source===n.id||e.target===n.id).map(e=>`<button class="issue" data-action="edge" data-id="${esc(e.id)}"><span>${esc(project.graph.nodes.find(x=>x.id===(e.source===n.id?e.target:e.source))?.name)}</span><small>${esc(relations[e.relation])}</small></button>`).join('')||'<p class="helper">Arraste um ponto do cartão até outro elemento para conectar.</p>'}<div class="button-row">${button('duplicate','Duplicar','copy')}${button('remove','Excluir elemento','trash','secondary danger')}</div>`;
}
function evidenceHtml(id){const e=project.graph.evidences.find(e=>e.id===id);const s=project.graph.sources.find(s=>s.id===e?.source_id);return e?`<div class="evidence"><strong>${icon('text',14)}${esc(s?.name||'Fonte')}</strong><blockquote>${esc(e.quote)}</blockquote><p>${esc(e.explanation)}</p></div>`:'';}
function importPanel(){return `<p class="intro">Transforme uma descrição em candidatos. Você decide o que entra no mapa.</p><div class="notice">${icon('bulb')}<span>Reconhecimento por padrões em português, sem IA. Todo candidato precisa de revisão.</span></div><form id="extract-form"><label>Nome da fonte<input name="sourceName" value="Descrição do processo" required maxlength="200"></label><label>Descrição<textarea name="content" rows="10" required minlength="3" maxlength="30000" placeholder="O cliente solicita a abertura da conta. Os documentos são recebidos e validados. A conta é aberta."></textarea></label><label>Ou carregar TXT / Markdown<input id="text-file" type="file" accept=".txt,.md,text/plain,text/markdown"></label><button class="primary full">${icon('search')} Encontrar candidatos</button></form><p class="helper">Até 30 mil caracteres. O conteúdo fica neste dispositivo. Negação e hipóteses não são transformadas em fatos.</p>`;}
function proposalsPanel(){const pending=project.graph.proposals.filter(p=>p.decision==='pending');return `<p class="intro">${pending.length} proposta${pending.length!==1?'s':''} aguardando revisão.</p><p class="helper">Aceitar cria ou atualiza o elemento como Pendente. Validar o conhecimento é uma decisão posterior do especialista.</p>${pending.map(p=>`<article class="proposal" data-proposal="${esc(p.id)}"><span class="type-badge" style="background:${kinds[p.node.kind].color}">Hipótese · ${esc(kinds[p.node.kind].label)}</span><label>Nome proposto<input data-proposal-field="name" value="${esc(p.node.name)}" maxlength="240"></label><label>Tipo<select data-proposal-field="kind">${options(kinds,p.node.kind)}</select></label><p>${esc(p.reason)}</p>${p.node.evidence_ids.map(id=>evidenceHtml(id)).join('')}<div class="button-row">${button('reject','Rejeitar','close','secondary',`data-id="${esc(p.id)}"`)}${button('accept',p.node.properties.ai_edit_target_id?'Aceitar alteração':'Aceitar','check','primary',`data-id="${esc(p.id)}"`)}</div></article>`).join('')||'<div class="empty-panel"><h3>Nenhuma revisão pendente</h3><p>Importe conteúdo ou continue a entrevista.</p></div>'}<details><summary>Decisões anteriores</summary>${project.graph.proposals.filter(p=>p.decision!=='pending').map(p=>`<p class="helper">${esc(p.node.name)}: ${p.decision==='accepted'?'aceita':'rejeitada'}</p>`).join('')||'<p>Nenhuma decisão anterior.</p>'}</details>`;}
function guidedPanel(){
  const hints={
    start:'Escolha um caso concreto e identifique o primeiro fato relevante. Nomeie o evento no passado, como Pedido Recebido.',
    end:'Defina o resultado que encerra esse caso. Use um fato ocorrido, como Pedido Entregue, para delimitar o processo.',
    middle:'Organize um acontecimento por cartão, do início ao fim. Conte o que aconteceu antes de pensar em telas ou soluções.',
    actors:'Identifique quem age, decide ou é informado. Coloque essas pessoas ou papéis perto das ações correspondentes.',
    failure:'Explore uma exceção real. Registre o caminho alternativo e marque as dúvidas com hotspots.',
    systems:'Identifique dependências fora do processo, como um serviço de pagamento ou outro sistema. Mostre onde participam.',
    rules:'Pergunte por que uma decisão é tomada e o que precisa ser verdadeiro para seguir. Dê exemplos concretos.',
    unknown:'Destaque o que ainda não foi entendido e quem pode esclarecer. Trate ideias e dúvidas como hipóteses até validar.'
  };
  return `<p class="intro">Um roteiro para conduzir seu primeiro EventStorming.</p><p class="helper">Percorra as perguntas nesta ordem com as pessoas do domínio e organize os acontecimentos no mapa.</p><ol class="guided-questions" aria-label="Roteiro da entrevista guiada">${questions.map(q=>`<li><h3>${esc(q.question.replace(' Escreva um acontecimento por linha.',''))}</h3><p class="helper">${esc(hints[q.id])}</p></li>`).join('')}</ol>`;
}
function sourcesPanel(){return `<p class="intro">${project.graph.sources.length} fontes preservadas</p>${project.graph.sources.map(s=>`<details class="source"><summary>${icon('text',17)} ${esc(s.name)}</summary><p class="helper">${esc(s.kind)} · ${date(s.created_at)} · ${project.graph.evidences.filter(e=>e.source_id===s.id).length} evidências</p><pre>${esc(s.content)}</pre></details>`).join('')||'<p class="helper">Importe texto ou responda uma entrevista para registrar fontes e evidências.</p>'}`;}
function qualityPanel(){return `<p class="intro">Pontos para conversar, não uma nota de completude.</p><div class="quality-numbers"><div><strong>${project.graph.nodes.filter(n=>n.status==='validated').length}</strong><span>validados</span></div><div><strong>${project.graph.nodes.filter(n=>n.kind==='hotspot').length}</strong><span>hotspots</span></div></div>${inspectProject(project).map(i=>`<button class="issue" data-action="${i.code==='proposal'?'proposals':'select'}" data-id="${esc(i.node_id||'')}"><span>${esc(i.message)}</span><small>${esc(i.code)}</small></button>`).join('')||'<p class="helper">Nenhuma pendência detectada pelas regras básicas. Valide cenários reais com especialistas.</p>'}${button('blueprint','Exportar blueprint','text','secondary full')}`;}
function settingsPanel(){return `${field('Nome do projeto','project.name',project.name,'input','maxlength="160"')}${field('Objetivo e escopo','project.objective',project.objective,'textarea','maxlength="2000" rows="6"')}<div class="notice">${store.backend==='memory'?'Este navegador está mantendo o projeto apenas nesta sessão. Exporte antes de fechar.':'Tudo é salvo no navegador atual. Exporte uma cópia com histórico para manter um backup independente.'}</div><p class="helper">Big Picture, Processo e Software Design registram a intenção do workshop e usam o mesmo grafo. Use o facilitador com IA para construir o fluxo pela conversa ou a entrevista guiada para seguir o roteiro sem modelo.</p>${button('export-bundle','Exportar backup com histórico','download','secondary full')}${button('blueprint','Exportar blueprint','text','secondary full')}`;}
function edgePanel(){const e=project.graph.edges.find(e=>e.id===edgeSelected);return e?`<p class="intro">${esc(project.graph.nodes.find(n=>n.id===e.source)?.name)} ${icon('arrow',14)} ${esc(project.graph.nodes.find(n=>n.id===e.target)?.name)}</p><label>Tipo da relação<select data-edge-field="relation">${options(relations,e.relation)}</select></label><label>Rótulo opcional<input data-edge-field="label" value="${esc(e.label)}" maxlength="200"></label>${button('remove-edge','Excluir relação','trash','secondary danger full')}`:'<p>Relação removida.</p>';}
function historyPanel(entries){return `<p class="helper">Restaurar preserva o estado atual e cria uma nova versão. As versões anteriores permanecem disponíveis.</p><form id="version-form"><label>Descrição da versão<input name="message" maxlength="240" placeholder="Ex.: Descoberta validada com operações"></label><button class="primary full">${icon('check')} Salvar versão</button></form>${entries.map(e=>`<article class="history-entry"><span class="history-point"></span><h3>${esc(e.message||'Versão salva')}</h3><p class="helper">${esc(typeof e.author==='object'?e.author.name:e.author||'Especialista local')} · ${date(e.timestamp)}</p><p class="helper">${esc(typeof e.summary==='string'?e.summary: Array.isArray(e.diff)?`${e.diff.length} alterações registradas`:'Estado do projeto preservado')}</p><div class="button-row">${button('version-details','Ver alterações','search','secondary',`data-id="${esc(e.id)}"`)}${button('restore','Restaurar','history','secondary',`data-id="${esc(e.id)}"`)}</div></article>`).join('')||'<p class="helper">Salve uma versão para iniciar o histórico.</p>'}${button('export-bundle','Exportar backup com histórico','download','secondary full')}`;}
function repositoryPanel(){const adapter=engine.adapter,remembered=Boolean(adapter?.handle);return `<p class="intro">Versões locais e compartilhamento por pasta</p><div class="notice">${icon('shield')}<span>${store.backend==='memory'?'Suas alterações estão apenas nesta sessão. Exporte uma cópia antes de fechar.':'Suas alterações ficam neste dispositivo mesmo quando a pasta está indisponível.'}</span></div><p class="helper">${remembered?'A pasta deste projeto já está configurada. Permita acesso novamente se necessário.':'Escolha uma pasta vazia para criar uma base ou a pasta do mesmo projeto para retomar.'}</p>${remembered?button('reconnect','Permitir acesso','folder','primary full'):button('choose-folder','Escolher pasta','folder','primary full')}${button('sync','Sincronizar','arrow','secondary full')}<div class="notice"><span>Compartilhamento por pasta é experimental. Publicações simultâneas ficam preservadas como versões paralelas e são reconciliadas ao sincronizar novamente. Não há colaboração em tempo real nem confirmação global entre dispositivos.</span></div>${!('showDirectoryPicker' in window)?'<p class="helper">Este navegador não oferece seleção de pasta. Use exportação e importação de backups; a edição local continua disponível.</p>':''}${button('export-bundle','Exportar backup com histórico','download','secondary full')}<p class="helper">Se outra pessoa envia uma exportação do mesmo histórico, importe o pacote e sincronize para conciliar as diferenças.</p><p class="helper">Status: ${esc(syncLabel())}</p>`;}
function syncLabel(){return ({updated:'Atualizado',local_changes:'Alterações salvas neste dispositivo',needs_resolution:'Resolver diferenças',offline:'Sem conexão',permission_lost:'Acesso à pasta necessário',repository_missing:'Pasta não encontrada. Escolha uma pasta novamente',integrity_error:'Não é seguro sincronizar',sync_error:'Não foi possível sincronizar',publication_pending:'Versão publicada; verificar outras alterações'})[engine.state.syncState]||'Alterações salvas neste dispositivo';}
function humanPath(change){
  const labels={name:'Nome',description:'Descrição',status:'Estado',position:'Posição',x:'Horizontal',y:'Vertical',context:'Contexto',kind:'Tipo',origin:'Origem',author:'Autor',properties:'Propriedades',pivotal:'Evento central',evidence_ids:'Evidências',objective:'Objetivo e escopo',modality:'Profundidade',nodes:'Elementos',edges:'Relações',sources:'Fontes',evidences:'Evidências',proposals:'Propostas',answers:'Respostas',relation:'Significado',label:'Rótulo',content:'Conteúdo',quote:'Trecho',explanation:'Explicação',decision:'Decisão',reason:'Motivo',answer:'Resposta',question:'Pergunta',$order:'Ordem'};
  const parts=(Array.isArray(change.path)?change.path.map(p=>typeof p==='object'?p.id:p):String(change.path||'').split('/')).filter(Boolean);
  const collection=parts[0]==='graph'?parts[1]:null,entityId=change.entityId||(collection?parts[2]:null);
  const values=collection&&Array.isArray(project?.graph[collection])?project.graph[collection]:[];
  const entity=values.find(item=>item.id===entityId);
  const snapshot=[change.localValue,change.remoteValue,change.baseValue,change.after,change.before].find(v=>v&&typeof v==='object'&&v.name);
  const name=entity?.name||entity?.node?.name||snapshot?.name;
  const fields=parts.slice(collection?(entityId&&parts[2]===entityId?3:2):0).filter(p=>p!=='id').map(p=>labels[p]||(/^[a-f0-9-]{24,}$/i.test(p)?'Conteúdo':p));
  return [name||(collection?labels[collection]:null),...fields].filter(Boolean).join(' › ')||'Conteúdo do projeto';
}
function valueHtml(value){if(value===undefined||value===null)return '<em>Removido ou ausente</em>';if(typeof value!=='object')return esc(value);if(Array.isArray(value))return `<ul>${value.map(v=>`<li>${valueHtml(v)}</li>`).join('')}</ul>`;if(value.name)return `<strong>${esc(value.name)}</strong><p>${esc(value.description||'')}</p><p class="helper">${esc(kinds[value.kind]?.label||'Elemento')} · ${esc(statuses[value.status]||'')}</p>`;return `<dl>${Object.entries(value).filter(([k])=>!['id','created_at','updated_at'].includes(k)).slice(0,20).map(([k,v])=>`<dt>${esc(({position:'Posição',x:'Horizontal',y:'Vertical',description:'Descrição',status:'Estado',name:'Nome',context:'Contexto'})[k]||k)}</dt><dd>${valueHtml(v)}</dd>`).join('')}</dl>`;}
function resolvedValue(conflict){let value=project;for(const token of conflict.tokens||[]){if(token==='$order')return value?.map(item=>item.name||item.id);value=typeof token==='object'?value?.find(item=>item.id===token.id):value?.[token];}return value;}
function conflictPanel(){
  if(!engine.state.conflictSession&&resolvedReview)return `<p class="intro">Todas as diferenças foram resolvidas.</p><p class="helper">Suas decisões foram preservadas em uma versão local. Conclua a sincronização para compartilhar e verificar alterações mais recentes.</p>${resolvedReview.conflicts.map(c=>`<article class="conflict"><h3>${esc(humanPath(c))}</h3><div class="conflict-value">${valueHtml(resolvedValue(c))}</div><p class="helper">Decisão registrada</p></article>`).join('')}${button('finish-sync','Concluir e sincronizar','check','primary full')}`;
  const session=engine.state.conflictSession;const cs=session?.conflicts||[];const pending=cs.filter(c=>c.status!=='resolved'&&!c.resolution);return `<p class="intro">Você e outra pessoa alteraram o mesmo conteúdo. Escolha como ele deve ficar.</p><p class="helper">${cs.length-pending.length} de ${cs.length} diferenças resolvidas. Nenhuma escolha será compartilhada antes de concluir.</p>${cs.map((c,i)=>`<article class="conflict"><h3>Diferença ${i+1} · ${esc(humanPath(c))}</h3><details><summary>Antes</summary><div class="conflict-value">${valueHtml(c.baseValue)}</div></details><div class="compare"><div><strong>Sua alteração</strong><div class="conflict-value">${valueHtml(c.localValue)}</div></div><div><strong>Alteração compartilhada</strong><div class="conflict-value">${valueHtml(c.remoteValue)}</div></div></div><div class="button-row">${button('resolve-local','Usar a minha','','secondary',`data-id="${esc(c.conflictId||c.id)}"`)}${button('resolve-remote','Usar a compartilhada','','secondary',`data-id="${esc(c.conflictId||c.id)}"`)}</div>${typeof c.localValue==='string'&&typeof c.remoteValue==='string'?`<label>Editar resultado<textarea data-custom-result="${esc(c.conflictId||c.id)}" rows="3">${esc(c.localValue)}</textarea></label>${button('resolve-custom','Usar resultado editado','','secondary full',`data-id="${esc(c.conflictId||c.id)}"`)}`:''}<p class="helper">${c.status==='resolved'||c.resolution?'Resolvida':'Precisa de decisão'}</p></article>`).join('')}${button('finish-sync','Concluir sincronização','check','primary full',pending.length?'disabled':'')}`;}
function mergeExtraction(result){mutate(p=>{p.graph.sources.push(result.source);p.graph.evidences.push(...result.evidences);p.graph.proposals.push(...result.proposals);if(result.answer)p.graph.answers.push(result.answer);},{refreshPanel:true});}
function adoptEngineCopy(){
  project=clone(engine.state.workingCopy);past=[];future=[];selected=new Set([...selected].filter(id=>project.graph.nodes.some(n=>n.id===id)));connectionFrom=null;edgeSelected=null;resolvedReview=null;
  const title=$('.project-title');if(title)title.textContent=project.name;
  const avatar=$('.project-avatar');if(avatar)avatar.textContent=project.name.slice(0,1).toUpperCase();
}
async function synchronize(){
  await exclusive(async()=>{
    if(engine.state.conflictSession){showPanel('conflicts');return;}
    if(!engine.adapter){showPanel('repository');return;}
    toast('Sincronizando…');await engine.sync();adoptEngineCopy();await store.set(`project:${project.id}`,project);renderView();showPanel(engine.state.conflictSession?'conflicts':'repository');toast(syncLabel());
  });
}
function createModal(text=false){modalRoot.innerHTML=`<div class="modal-backdrop"><form id="create-form" class="modal" role="dialog" aria-modal="true" aria-labelledby="create-title" data-mode="${text?'text':'manual'}"><h2 id="create-title">O que vamos descobrir?</h2><p>Dê um nome ao domínio ou processo que deseja explorar.</p><label>Nome do projeto<input name="name" required maxlength="160" placeholder="Ex.: Abertura de conta PJ"></label><label>Objetivo e escopo<textarea name="objective" maxlength="2000" rows="4" placeholder="O que precisamos entender? Quem pode ajudar?"></textarea></label><div class="button-row">${button('close-modal','Cancelar','','secondary')}<button class="primary">Criar projeto</button></div></form></div>`;$('input',modalRoot).focus();}
function closeModal(){modalRoot.innerHTML='';}
function contextMenu(id,x,y){select(id,false,false);document.querySelector('.context-menu')?.remove();const el=document.createElement('div');el.className='context-menu';el.setAttribute('role','menu');el.style.left=`${Math.min(x,window.innerWidth-195)}px`;el.style.top=`${Math.min(y,window.innerHeight-130)}px`;el.innerHTML=button('duplicate','Duplicar','copy','menu-button')+button('remove','Excluir','trash','menu-button');document.body.append(el);setTimeout(()=>document.addEventListener('click',()=>el.remove(),{once:true}),0);}
async function chooseFile(){
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.addEventListener('change',()=>run(()=>exclusive(async()=>{
    const file=input.files[0];if(!file)return;if(file.size>64_000_000)throw Error('Arquivo acima de 64 MB.');
    const data=JSON.parse(await file.text());
    if(data.format==='event-storm-local-bundle'){
      if(!data.state?.workingCopy||!Array.isArray(data.objects))throw Error('O pacote não contém uma cópia e histórico válidos do projeto.');
      if(!project)await open(validateProject(data.state.workingCopy));
      await engine.importBundle(data);adoptEngineCopy();await store.set(`project:${project.id}`,project);renderWorkspace();showPanel(engine.state.conflictSession?'conflicts':'repository');toast('Histórico importado. Sincronize para verificar diferenças.');
    }else{await create(importProject(data));toast('Projeto importado como nova descoberta.');}
  })));
  input.click();
}
async function action(action,el){
  if(action.startsWith('http-')){await httpAction(action,el);return;}
  if(action==='ai-cancel'){aiAbort?.abort('cancelled');return;}if(action==='ai-reconnect'){aiConfig=null;aiConfigError='';aiRemoteConsent=false;await loadAIConfig();return;}
  if(busy&&!['close-panel','theme'].includes(action))return;if(engine?.state?.conflictSession&&['add','undo','redo','duplicate','remove','accept','reject','remove-edge','restore'].includes(action)){toast('Resolva as diferenças antes de alterar o mapa.');return;}
  if(action==='theme'){theme();return;}if(action==='new'||action==='new-text'){createModal(action==='new-text');return;}if(action==='close-modal'){closeModal();return;}if(action==='import-json'){await chooseFile();return;}if(action==='open'){await open(projects.find(p=>p.id===el.dataset.id));return;}if(action==='example'){await create(exampleProject());board?.fit();return;}if(!project)return;
  if(action==='back'){await back();return;}if(action==='close-panel'){panel=null;renderPanel();return;}if(action==='edge'){edgeSelected=el.dataset.id;showPanel('edge');return;}if(titles[action]){showPanel(action);return;}if(action==='add'){add(el.dataset.kind);return;}if(action==='select'){select(el.dataset.id);return;}if(action==='edge'){edgeSelected=el.dataset.id;showPanel('edge');return;}
  if(action==='undo'||action==='redo'){undo(action==='redo');return;}if(action==='duplicate'){duplicate();return;}if(action==='remove'){removeSelected();return;}if(action==='canvas-view'||action==='list-view'){view=action==='list-view'?'list':'canvas';board?.destroy();board=null;renderWorkspace();return;}
  if(action==='export-json'){await queue.catch(()=>{});download(project,`${filename()}.json`);return;}if(action==='blueprint'){download(exportBlueprint(project),`${filename()}-blueprint.md`,'text/markdown');return;}if(action==='export-bundle'){await exclusive(async()=>{if(!engine.state.conflictSession)await engine.saveVersion('Backup exportado','Especialista local');download(await engine.exportBundle(),`${filename()}-historico.json`);renderPanel();});return;}
  if(action==='accept'||action==='reject'){mutate(p=>{const proposal=p.graph.proposals.find(p=>p.id===el.dataset.id);proposal.decision=action==='accept'?'accepted':'rejected';if(action==='accept'){const n=clone(proposal.node);n.status=n.status==='contested'?'contested':'pending';const targetId=n.properties.ai_edit_target_id;const existing=p.graph.nodes.findIndex(item=>item.id===(targetId||n.id));if(targetId&&existing<0)throw Error('O elemento dessa proposta foi removido. Revise o mapa antes de aceitar a alteração.');if(existing>=0){const original=p.graph.nodes[existing];p.graph.nodes[existing]={...original,kind:n.kind,name:n.name,description:n.description,context:n.context,status:n.status,origin:n.origin,evidence_ids:[...new Set([...original.evidence_ids,...n.evidence_ids])],updated_at:new Date().toISOString()};}else{n.position={x:80+p.graph.nodes.length%5*245,y:100+Math.floor(p.graph.nodes.length/5)*190};p.graph.nodes.push(n);}}},{refreshPanel:true});return;}
  if(action==='remove-edge'){mutate(p=>p.graph.edges=p.graph.edges.filter(e=>e.id!==edgeSelected),{refreshPanel:true});return;}
  if(action==='choose-folder'){await exclusive(async()=>{const a=await FolderRepositoryAdapter.select(store,project.id,engine.state.repositoryId);if(a){await engine.attach(a);showPanel('repository');toast('Pasta conectada. Sincronize para compartilhar as versões.');}});return;}
  if(action==='reconnect'){await exclusive(async()=>{const adapter=engine.adapter;if(!adapter)return;await adapter.reconnect();await engine.attach(adapter);await engine.sync();adoptEngineCopy();await store.set(`project:${project.id}`,project);renderView();showPanel(engine.state.conflictSession?'conflicts':'repository');toast(syncLabel());});return;}
  if(action==='sync'||action==='finish-sync'){await synchronize();return;}
  if(action==='restore'){await exclusive(async()=>{await engine.restore(el.dataset.id);adoptEngineCopy();await store.set(`project:${project.id}`,project);renderView();renderPanel();toast('Versão restaurada. O histórico anterior foi preservado.');});return;}
  if(action==='version-details'){const entries=await engine.history(),entry=entries.find(e=>e.id===el.dataset.id);modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Alterações da versão"><h2>${esc(entry.message||'Alterações da versão')}</h2><p class="helper">${date(entry.timestamp)}</p><div class="version-diff">${(entry.diff||[]).map(d=>`<p><strong>${esc(d.type||d.op||'Alteração')}</strong> · ${esc(humanPath(d))}</p>`).join('')||'<p>Estado inicial do projeto.</p>'}</div>${button('close-modal','Fechar','','primary')}</div></div>`;return;}
  if(action.startsWith('resolve-')){const choice=action==='resolve-local'?'local':action==='resolve-remote'?'remote':'edit';const custom=choice==='edit'?$(`[data-custom-result="${CSS.escape(el.dataset.id)}"]`).value:undefined;await exclusive(async()=>{const session=engine.state.conflictSession;await engine.resolveConflict(el.dataset.id,choice,custom);if(!engine.state.conflictSession){adoptEngineCopy();resolvedReview=clone(session);await store.set(`project:${project.id}`,project);renderView();showPanel('conflicts');toast('Decisões preservadas. Conclua a sincronização para compartilhar.');}else renderPanel();});return;}
}

document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(el)run(()=>action(el.dataset.action,el));});
document.addEventListener('input',e=>{
  const el=e.target;if(!project||busy)return;if(locked()&&(el.dataset.field||el.dataset.proposalField||el.dataset.edgeField))return;
  if(el.dataset.httpField||el.dataset.httpRow){editHTTPField(el);return;}if(el.id==='http-test-message'){httpTestMessage=el.value;return;}if(el.id==='ai-message'){aiDraft=el.value;saveAIText().catch(()=>{aiFailure='Não foi possível salvar o rascunho da mensagem. Copie o texto antes de fechar.';});return;}if(el.id==='ai-model'){aiModel=el.value.trim();return;}
  if(el.id==='search'){search=el.value;renderView();return;}
  if(el.dataset.field){const key=el.dataset.field;if(['name','project.name'].includes(key)&&!el.value.trim())return;mutate(p=>{if(key.startsWith('project.'))p[key.slice(8)]=el.value||' ';else{const n=p.graph.nodes.find(n=>selected.has(n.id));if(n){if(key==='pivotal')n.properties.pivotal=el.checked;else if(key.startsWith('properties.')){if(!el.value||!Number.isFinite(Number(el.value)))return;if(n.kind==='context'){const bounds=nodeBounds(n,p.graph.nodes);n.position={x:bounds.x,y:bounds.y};}n.properties[key.slice(11)]=Number(el.value);}else n[key]=el.value|| (key==='name'?' ':'');n.updated_at=new Date().toISOString();}}},{redraw:true});if(key==='project.name')$('.project-title').textContent=project.name;}
  if(el.dataset.proposalField){if(el.dataset.proposalField==='name'&&!el.value.trim())return;mutate(p=>{const pr=p.graph.proposals.find(p=>p.id===el.closest('[data-proposal]').dataset.proposal);pr.node[el.dataset.proposalField]=el.value||' ';},{redraw:false});}
  if(el.dataset.edgeField)mutate(p=>p.graph.edges.find(e=>e.id===edgeSelected)[el.dataset.edgeField]=el.value);
});
document.addEventListener('change',e=>run(async()=>{const el=e.target;if(busy)return;if(el.id==='http-profile'){httpEditorId=el.value;httpNotice='';httpPreview='';httpResult=null;await saveHTTPDraft();renderPanel();return;}if(el.id==='http-preset'&&el.value){const previous=selectedHTTPRequest(),r=newHTTPRequest(el.value);r.id=previous.id;httpDraft.requests[httpDraft.requests.indexOf(previous)]=r;httpNotice='Modelo aplicado. Ajuste os campos e salve.';httpPreview='';httpResult=null;await saveHTTPDraft();renderPanel();return;}if(el.dataset.httpField||el.dataset.httpRow){editHTTPField(el);if(el.dataset.httpField==='method'&&['GET','HEAD'].includes(el.value))selectedHTTPRequest().body_type='none';if(['auth.type','body_type','method'].includes(el.dataset.httpField))renderPanel();return;}if(el.id==='http-config-file'){const file=el.files[0];if(!file)return;if(file.size>1000000)throw Error('Configuração excede 1 MB.');const imported=JSON.parse(await file.text());if(imported.format!=='event-storm-local-http'||imported.version!==1)throw Error('Arquivo de configuração HTTP não reconhecido.');httpDraft=normalizeAIHTTP(imported.ai_http);httpEditorId=httpDraft.active_id||httpDraft.requests[0]?.id||'';httpNotice='Configuração importada. Clique em Salvar e usar para ativar.';httpPreview='';httpResult=null;await saveHTTPDraft();renderPanel();return;}if(el.id==='ai-consent')aiRemoteConsent=el.checked;if(el.id==='filter'){filter=el.value;renderView();}if(el.id==='modality')mutate(p=>p.modality=el.value);if(el.id==='ai-file'){const file=el.files[0];if(!file)return;if(file.size>100000||!/(\.txt|\.md)$/i.test(file.name))throw Error('Use TXT ou Markdown até 100 KB.');const content=await file.text();if(content.length>30000)throw Error('Máximo de 30 mil caracteres. Divida o conteúdo.');aiDraft=content;await saveAIText();$('#ai-message').value=content;}if(el.id==='text-file'){const f=el.files[0];if(!f)return;if(f.size>100_000||!/(\.txt|\.md)$/i.test(f.name))throw Error('Use TXT ou Markdown até 100 KB.');const content=await f.text();if(content.length>30_000)throw Error('Máximo de 30 mil caracteres. Divida o conteúdo.');$('#extract-form [name="content"]').value=content;$('#extract-form [name="sourceName"]').value=f.name;}}));
document.addEventListener('submit',e=>{e.preventDefault();run(async()=>{const f=e.target;if(busy)return;if(locked()&&['extract-form','ai-form','version-form'].includes(f.id)){toast('Resolva as diferenças antes de continuar.');return;}if(f.id==='create-form'){const name=f.elements.name.value.trim();if(!name)return;const text=f.dataset.mode==='text';await create(newProject(name,f.elements.objective.value));closeModal();showPanel(text?'import':'interview');}if(f.id==='ai-form'){await sendAI(f);return;}if(f.id==='extract-form'){mergeExtraction(extractContent(project,f.elements.sourceName.value,f.elements.content.value));showPanel('proposals');}if(f.id==='version-form'){const message=f.elements.message.value;await exclusive(async()=>{await engine.saveVersion(message||'Versão salva','Especialista local');renderPanel();updateStatus();toast('Versão preservada no histórico.');});}});});
document.addEventListener('dragstart',e=>{const el=e.target.closest('[data-kind]');if(locked()){e.preventDefault();return;}if(el)e.dataTransfer.setData('application/eventstorming',el.dataset.kind);});
document.addEventListener('dragover',e=>{if(e.target.closest('.board'))e.preventDefault();});
document.addEventListener('drop',e=>{if(locked()||!board||!e.target.closest('.board'))return;e.preventDefault();const kind=e.dataTransfer.getData('application/eventstorming');if(kinds[kind])add(kind,board.point(e));});
document.addEventListener('keydown',e=>{
  if(modalRoot.firstChild){if(e.key==='Escape')closeModal();if(e.key==='Tab'){const items=[...modalRoot.querySelectorAll('button,input,textarea,select,[tabindex]')].filter(el=>!el.disabled);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}return;}
  if(!project||busy||e.target.closest('input,textarea,select,[contenteditable]'))return;
  if(e.key==='Escape'){connectionFrom=null;selected.clear();panel=null;board?.update();renderPanel();return;}
  if(locked())return;if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelected();}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();duplicate();}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();selected=new Set(project.graph.nodes.filter(visible).map(n=>n.id));board?.update();}
  const card=e.target.closest('.sticky');if(card&&e.key==='Enter')select(card.dataset.id,e.shiftKey);if(card&&e.key==='F2'){e.preventDefault();board?.inline(card.dataset.id);}
  if(card&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();mutate(p=>{const n=p.graph.nodes.find(n=>n.id===card.dataset.id);if(n.kind==='context'){const bounds=nodeBounds(n,p.graph.nodes);n.position={x:bounds.x,y:bounds.y};n.properties.width=bounds.width;n.properties.height=bounds.height;}const d=e.shiftKey?40:20;if(e.key==='ArrowUp')n.position.y-=d;if(e.key==='ArrowDown')n.position.y+=d;if(e.key==='ArrowLeft')n.position.x-=d;if(e.key==='ArrowRight')n.position.x+=d;});$('.board')?.querySelector(`[data-id="${CSS.escape(card.dataset.id)}"]`)?.focus();}
});
window.addEventListener('beforeunload',e=>{if(project&&(revision>savedRevision||store.backend==='memory')){e.preventDefault();e.returnValue='';}});
window.addEventListener('offline',()=>{if(project)toast(store.backend==='memory'?'Sem conexão. A edição continua nesta sessão; exporte antes de fechar.':'Sem conexão. A edição e o salvamento local continuam disponíveis.');});
async function boot(){try{document.documentElement.dataset.theme=localStorage.getItem('es-local-theme')||'light';}catch{}await store.open();await refresh();renderHome();if(['http:','https:'].includes(location.protocol)&&'serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});}
run(boot);

// Layout fixtures exercise shipped navigation without changing saved account data. Reload removes all fixtures.
import assert from 'node:assert/strict';
import{mkdir,writeFile}from'node:fs/promises';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const b=await chromium.connectOverCDP(process.env.APP_CDP||'http://127.0.0.1:9226',{noDefaults:true});
const p=b.contexts()[0].pages().find(p=>p.url().match(process.env.APP_CDP?/com\.jinmx\.independent\.playback/:/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const c=await p.context().newCDPSession(p);await c.send('Emulation.setFocusEmulationEnabled',{enabled:true});
const saved=await p.evaluate(()=>({skip:localStorage.getItem('test.skipProfilePrompt')}));
const report={date:new Date().toISOString(),environment:process.env.APP_CDP?'LG G6 TV':'webOS Simulator',fixtureLayout:true,cases:[]};
try{
 await p.waitForFunction(()=>window.showPage&&heroItem);
 await p.evaluate(()=>{
  if(profilePicker.open)profilePicker.close();localStorage.setItem('test.skipProfilePrompt','1');heroPreview.stop();
  const seed=heroItem;
  window.topAuditItems=Array.from({length:32},(_,i)=>({...seed,bvid:`audit-${i}`,title:`回顶测试 ${i+1}`}));
  loadLibrary=async()=>{};libraryMore=async()=>{};loadPopular=async()=>{};loadRecommend=async()=>{};
  libraryState.loaded=true;libraryLogin.hidden=true;popularDone=true;recommendBusy=true;
 });
 const names=['browse','popular','following','later','cloud-history','favorites','search','search-keyboard','up','detail','settings'];
 for(const method of (process.env.METHODS||'keyboard,wheel').split(','))for(const name of names){
  const info=await p.evaluate(name=>{
   detail.hidden=true;upPage.hidden=true;home.hidden=false;
   const fill=row=>row.replaceChildren(...topAuditItems.map(item=>videoCard(item,'回顶测试')));
   const buttons=(row,n)=>row.replaceChildren(...Array.from({length:n},(_,i)=>{const button=document.createElement('button');button.textContent=`项目 ${i+1}`;return button;}));
   let container,first,steps;
   if(name==='up'){
    upPage.hidden=false;home.hidden=true;fill(upGrid);detailStack.length=0;detailStack.push({up:'audit',page:1,more:false});container=upPage;first=upGrid.firstElementChild;steps=11;
   }else if(name==='detail'){
    detail.hidden=false;home.hidden=true;detailPlay.hidden=false;detailLater.hidden=true;
    document.querySelector('#detail-pages-shelf').hidden=true;document.querySelector('#detail-related-shelf').hidden=false;fill(detailRelated);
    document.querySelector('#detail-people-shelf').hidden=false;buttons(document.querySelector('#detail-people'),4);
    document.querySelector('#detail-about').hidden=false;buttons(document.querySelector('#detail-about-cards'),4);
    container=detail;first=detailPlay;steps=6;
   }else{
    showPage(name==='search-keyboard'?'search':name);
    if(name==='browse'){historyRow.closest('.shelf').hidden=true;fill(recommendGrid);first=heroPlay;steps=12;}
    else if(name==='popular'){fill(grid);first=grid.firstElementChild;steps=14;}
    else if(libraryPages[name]){const row=name==='favorites'?libraryRows[4]:document.querySelector(`#${libraryPages[name]} .row`);fill(row);row.closest('.shelf').hidden=false;if(name==='favorites'){buttons(libraryRows[3],4);first=libraryRows[3].firstElementChild;}else first=row.firstElementChild;showLibraryShelf();steps=12;}
    else if((name==='search'||name==='search-keyboard')){searchResults.hidden=false;trendingSection.hidden=true;searchSuggest.hidden=true;searchMore.hidden=true;fill(searchGrid);first=searchGrid.firstElementChild;steps=16;}
    else if(name==='settings'){container=document.querySelector('.settings-list');first=pageFocusables()[0];steps=pageFocusables().length+2;}
    container||=document.scrollingElement;
   }
   window.scrollTo(0,0);container.scrollTop=0;first.focus({preventScroll:true});window.topAuditContainer=container;return{steps};
  },name);
  for(let i=0;i<info.steps;i++){if(method==='keyboard')await p.keyboard.press('ArrowDown');else{await p.mouse.wheel(0,100);await p.waitForTimeout(200);}}
  const bottom=await p.evaluate(()=>({scroll:topAuditContainer.scrollTop,window:window.scrollY}));
  if(name==='search-keyboard')for(let i=0;i<4&&!(await p.evaluate(()=>!!document.activeElement.closest('#search-keys')));i++){await p.keyboard.press('ArrowLeft');await p.waitForTimeout(100);}
  assert.ok(bottom.scroll>0||bottom.window>0,`${name} fixture must really scroll`);
  for(let i=0;i<info.steps+4;i++){if(method==='keyboard')await p.keyboard.press('ArrowUp');else{await p.mouse.wheel(0,-100);await p.waitForTimeout(200);}}
  const top=await p.evaluate(()=>({scroll:topAuditContainer.scrollTop,window:window.scrollY,focus:document.activeElement.id||document.activeElement.dataset.bvid||document.activeElement.textContent.slice(0,20),sidebar:document.querySelector('#sidebar').matches(':focus-within')}));
  const result=top.scroll===0&&top.window===0&&!top.sidebar?'PASS':'FAIL';
  report.cases.push({name,method,bottom,top,result});console.log(JSON.stringify(report.cases.at(-1)));
 }
 report.result=report.cases.every(x=>x.result==='PASS')?'PASS':'FAIL';
 assert.equal(report.result,'PASS','All pages must return to full top without opening sidebar');
} catch(e){report.result='FAIL';report.error=e.message;throw e;}finally{
 await p.reload();await p.waitForFunction(()=>window.showPage);
 await p.evaluate(s=>{if(s.skip===null)localStorage.removeItem('test.skipProfilePrompt');else localStorage.setItem('test.skipProfilePrompt',s.skip);},saved);
 await c.send('Emulation.setFocusEmulationEnabled',{enabled:false});await c.detach();
 await mkdir('output/playwright',{recursive:true});await writeFile(`output/playwright/${process.env.OUT||'simulator-page-top'}.json`,JSON.stringify(report,null,2));await b.close();
}

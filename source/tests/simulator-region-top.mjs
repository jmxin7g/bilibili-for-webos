import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const b=await chromium.connectOverCDP('http://127.0.0.1:9226',{noDefaults:true});
const p=b.contexts()[0].pages().find(p=>decodeURI(p.url()).match(/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const saved=await p.evaluate(()=>{window.regionReturnFocus=document.activeElement;return{page:activePage,scroll:window.scrollY,skip:localStorage.getItem('test.skipProfilePrompt'),profile:profilePicker.open};});
const r={date:new Date().toISOString(),environment:'webOS Simulator only',checks:[]};
try{
 await p.evaluate(()=>{localStorage.setItem('test.skipProfilePrompt','1');if(profilePicker.open)profilePicker.close();showPage('regions');});
 await p.waitForFunction(()=>!regionGrid.inert&&regionGrid.querySelector('.video-card'),null,{timeout:60000});
 const rows=await p.evaluate(()=>Math.ceil(regionGrid.children.length/4));r.rows=rows;assert.ok(rows>=3,'Need multiple actual video rows');
 for(const method of ['keyboard','wheel']){
  await p.evaluate(()=>{regionTabs.querySelector('[aria-pressed="true"]').focus({preventScroll:true});window.scrollTo(0,0);});
  for(let i=0;i<rows+1;i++){if(method==='keyboard')await p.keyboard.press('ArrowDown');else{await p.mouse.wheel(0,100);await p.waitForTimeout(200);}}
  const bottom=await p.evaluate(()=>({scroll:window.scrollY,index:[...regionGrid.children].indexOf(document.activeElement)}));
  assert.ok(bottom.scroll>100,'Must really scroll down');
  for(let i=0;i<rows+2;i++){if(method==='keyboard')await p.keyboard.press('ArrowUp');else{await p.mouse.wheel(0,-100);await p.waitForTimeout(200);}}
  const top=await p.evaluate(()=>({scroll:window.scrollY,focus:document.activeElement.parentElement.id,tab:document.activeElement.dataset.rid,tabTop:regionTabs.getBoundingClientRect().top,sidebar:document.querySelector('#sidebar').matches(':focus-within')}));
  r.checks.push({method,bottom,top});console.log(JSON.stringify(r.checks.at(-1)));
  if(method==='keyboard')await p.keyboard.press('ArrowDown');else{await p.mouse.wheel(0,100);await p.waitForTimeout(200);}
  assert.equal(await p.evaluate(()=>document.activeElement===regionGrid.firstElementChild),true,'Down can re-enter the videos after returning to the top');
 }
 assert.ok(r.checks.every(x=>x.top.focus==='region-tabs'),'Up must reach the category tabs');
 assert.ok(r.checks.every(x=>x.top.scroll===0),'Up must restore the very top, not just expose the tab');
 assert.ok(r.checks.every(x=>!x.top.sidebar),'Directions stay in content');
 await p.evaluate(()=>{regionTabs.querySelector('[aria-pressed="true"]').focus({preventScroll:true});window.scrollTo(0,300);});
 await p.keyboard.press('ArrowUp');
 assert.equal(await p.evaluate(()=>window.scrollY),0,'Up on a category tab restores the page top too');
 r.result='PASS';
}catch(e){r.result='FAIL';r.error=e.message;throw e;}finally{
 await p.evaluate(s=>{showPage(s.page);if(s.skip===null)localStorage.removeItem('test.skipProfilePrompt');else localStorage.setItem('test.skipProfilePrompt',s.skip);if(s.profile)profilePicker.showModal();if(window.regionReturnFocus.isConnected)window.regionReturnFocus.focus({preventScroll:true});delete window.regionReturnFocus;window.scrollTo(0,s.scroll);},saved);
 await mkdir('output/playwright',{recursive:true});
 await writeFile('output/playwright/simulator-region-top.json',JSON.stringify(r,null,2));await b.close();
}

import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const b=await chromium.connectOverCDP(process.env.APP_CDP||'http://127.0.0.1:9226',{noDefaults:true});
const p=b.contexts()[0].pages().find(p=>decodeURI(p.url()).match(process.env.APP_CDP?/com\.jinmx\.independent\.playback/:/independent-webos-app\/(output\/simulator-build\/)?app\/index\.html/));
const c=await p.context().newCDPSession(p);
if(process.env.APP_CDP)await c.send('Emulation.setFocusEmulationEnabled',{enabled:true});
const report={environment:process.env.APP_CDP?'TV':'Simulator',checks:[]};
const check=(name,value)=>{report.checks.push({name,pass:value});};
try{
 await p.waitForFunction(()=>grid.children.length>=12);
 await p.evaluate(()=>{if(profilePicker.open)profilePicker.close();showPage('popular');grid.firstElementChild.focus({preventScroll:true});window.scrollTo(0,0);});
 const layout=await p.evaluate(()=>({columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,top:grid.firstElementChild.getBoundingClientRect().top,pillBottom:document.querySelector('#nav-pill').getBoundingClientRect().bottom,art:[...grid.children].slice(0,12).map(x=>x.querySelector('.art').offsetWidth)}));
 report.layout=layout;check('cards below page pill',layout.top>layout.pillBottom+10);check('uniform artwork width',Math.max(...layout.art)-Math.min(...layout.art)<=1);
 await p.evaluate(()=>{popularDone=true;grid.children[2].focus({preventScroll:true});});await p.keyboard.press('ArrowUp');
 check('Up preserves top-row column',await p.evaluate(()=>document.activeElement===grid.children[2]&&scrollY===0));
 await p.evaluate(()=>{window.popularTestItems=[...grid.children].map(x=>({...heroItem,bvid:x.dataset.bvid}));while(grid.children.length>10)grid.lastElementChild.remove();grid.children[8].focus({preventScroll:true});});await p.keyboard.press('ArrowDown');
 check('Down preserves last-row column',await p.evaluate(()=>document.activeElement===grid.children[8]));
 await p.evaluate(async()=>{window.popularTestRequest=serviceRequest;serviceRequest=async path=>{if(path.startsWith('/popular?'))throw new Error('分页测试失败');return popularTestRequest(path);};popularDone=false;await loadPopular();grid.lastElementChild.focus({preventScroll:true});});await p.keyboard.press('ArrowDown');
 check('Down reaches visible retry',await p.evaluate(()=>document.activeElement===loadMore&&!loadMore.hidden));
 await p.keyboard.press('ArrowUp');check('Up returns from retry without jumping to top',await p.evaluate(()=>document.activeElement===grid.lastElementChild&&scrollY>0));
 await p.evaluate(()=>{serviceRequest=async path=>path.startsWith('/popular?')?{items:[popularTestItems[0],{...heroItem,bvid:'popular-test-new'}],noMore:true}:popularTestRequest(path);loadMore.focus({preventScroll:true});});await p.keyboard.press('Enter');await p.waitForTimeout(100);
 check('retry appends one unique card and focuses it',await p.evaluate(()=>grid.children.length===11&&document.activeElement.dataset.bvid==='popular-test-new'&&popularDone&&loadMore.hidden));
 report.result=report.checks.every(x=>x.pass)?'PASS':'FAIL';console.log(JSON.stringify(report));assert.equal(report.result,'PASS');
}finally{await p.reload();await mkdir('output/playwright',{recursive:true});await writeFile(`output/playwright/${process.env.OUT||'simulator-popular'}.json`,JSON.stringify(report,null,2));if(process.env.APP_CDP)await c.send('Emulation.setFocusEmulationEnabled',{enabled:false});await c.detach();await b.close();}

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

// One-file classroom server. Run with: node server.js
const PORT = Number(process.env.PORT || 3000);
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'teach701';
if (process.env.NODE_ENV === 'production' && (!process.env.TEACHER_PASSWORD || process.env.TEACHER_PASSWORD.length < 16)) {
  throw new Error('正式部署必須設定至少 16 個字元的 TEACHER_PASSWORD。');
}
const TEACHER_TOKEN = crypto.randomBytes(32).toString('hex');
const DB = path.join(__dirname, 'game-data.json');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
if (Boolean(SUPABASE_URL) !== Boolean(SUPABASE_SERVICE_KEY)) throw new Error('SUPABASE_URL 與 SUPABASE_SERVICE_KEY 必須同時設定。');
if (process.env.NODE_ENV === 'production' && (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_URL.startsWith('https://'))) throw new Error('正式部署必須設定 HTTPS 的 SUPABASE_URL 與 SUPABASE_SERVICE_KEY。');
const classIds = Array.from({ length: 7 }, (_, i) => `7${String(i + 1).padStart(2,'0')}`);
const demoQuestions = [
  { title: '暖身挑戰：找出俯視圖', prompt: '立體積木由底層組成：A1、A2、B1、B2、C2。請選出從正上方看到的所有格子。', rows: 5, cols: 5, answer: ['A1', 'A2', 'B1', 'B2', 'C2'], image: '' },
  { title: '挑戰二：方形底座', prompt: '一個立體的底面是 2×2 方形。請選出俯視圖中被占據的格子。', rows: 5, cols: 5, answer: ['B2', 'B3', 'C2', 'C3'], image: '' },
  { title: '挑戰三：階梯造型', prompt: '由上往下看，積木占據 A1、B1、B2、C1、C2、C3。請標示俯視圖。', rows: 5, cols: 5, answer: ['A1', 'B1', 'B2', 'C1', 'C2', 'C3'], image: '' }
];
function sampleSolid(cells) { const blocks=cells.map(s=>({r:s.charCodeAt(0)-65,c:Number(s.slice(1))-1})).sort((a,b)=>a.r+a.c-b.r-b.c);let shapes='';for(const {r,c} of blocks){const x=160+(c-r)*38,y=38+(r+c)*21;const top=`${x},${y} ${x+38},${y+21} ${x},${y+42} ${x-38},${y+21}`;shapes+=`<polygon points="${x-38},${y+21} ${x},${y+42} ${x},${y+86} ${x-38},${y+65}" fill="#5971db" stroke="#34449c" stroke-width="2"/><polygon points="${x},${y+42} ${x+38},${y+21} ${x+38},${y+65} ${x},${y+86}" fill="#4053b5" stroke="#34449c" stroke-width="2"/><polygon points="${top}" fill="#91a6ff" stroke="#34449c" stroke-width="2"/>`}const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="380" height="205" viewBox="0 0 380 205"><rect width="380" height="205" rx="18" fill="#f5f7ff"/><text x="24" y="27" font-family="sans-serif" font-size="13" font-weight="700" fill="#66708d">積木立體圖・每格代表一個單位積木</text>${shapes}</svg>`;return 'data:image/svg+xml,'+encodeURIComponent(svg); }
for(const q of demoQuestions)q.image=sampleSolid(q.answer);
function fresh(classCode='701') { const n=Number(classCode.slice(1));const zh=['一','二','三','四','五','六','七'][n-1];const used=new Set(Object.values(games).flatMap(g=>g.teams.map(t=>t.code)));const teams=Array.from({length:6},(_,i)=>{let code;do{code=String(crypto.randomInt(100000,1000000))}while(used.has(code));used.add(code);return{id:i+1,code,name:`第${i+1}組`,classCode,loggedIn:false,token:null,total:0,solved:{},wrong:{},submissions:[]}});return { title: '三視圖挑戰賽', className: `七年${zh}班`, classCode, questions: demoQuestions.map(q=>({...q,answer:[...q.answer]})), current: -1, status: 'setup', startedAt: null, endedAt: null, teams, events: [] }; }
let games={},needsPersist=false,state;
let persistChain = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify({classes:games});
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { fs.writeFileSync(DB, snapshot); return Promise.resolve(); }
  persistChain = persistChain.catch(() => undefined).then(() => supabase('/rest/v1/game_state?on_conflict=id', {method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id:1,data:JSON.parse(snapshot)})}));
  return persistChain;
}
function getGame(code='701'){return games[code]||games['701']}
async function initializeStorage() {
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const result = await supabase('/rest/v1/game_state?select=data&id=eq.1');
    if (result.length) games = result[0].data.classes || {};
  } else {
    try { const saved=JSON.parse(fs.readFileSync(DB,'utf8'));if(saved.classes)games=saved.classes;else{games['701']=saved;for(const c of classIds.slice(1))games[c]=fresh(c);needsPersist=true} }
    catch { for(const c of classIds)games[c]=fresh(c);needsPersist=true; }
  }
  if(Object.keys(games).length!==classIds.length){for(const c of classIds)if(!games[c])games[c]=fresh(c);needsPersist=true}
  for(const c of classIds)for(const t of getGame(c).teams)t.classCode=c;
  if(needsPersist) await persist();
}
async function supabase(path, options={}) {
  const response=await fetch(`${SUPABASE_URL}${path}`,{...options,headers:{apikey:SUPABASE_SERVICE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_KEY}`,'Content-Type':'application/json',...(options.headers||{})}});
  if(!response.ok)throw new Error(`Supabase 回應 ${response.status}: ${(await response.text()).slice(0,300)}`);
  if(response.status===204)return null;
  const text=await response.text();return text?JSON.parse(text):null;
}
function send(res, code, data, type = 'application/json; charset=utf-8') { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data); }
function pub(game,viewerTeamId=null,isTeacher=false) { const nets=os.networkInterfaces(); const ip=Object.values(nets).flat().find(x=>x && x.family==='IPv4' && !x.internal)?.address; return { title: game.title, className: game.className, classCode: game.classCode, availableClasses:classIds.map(c=>({code:c,name:getGame(c).className,status:getGame(c).status,questionCount:getGame(c).questions.length})),joinUrl:process.env.NODE_ENV==='production'?'':(ip?`http://${ip}:${PORT}`:`http://localhost:${PORT}`), questions: game.questions.map(({answer,...q})=>isTeacher?{...q,answer}:q), current: game.current, status: game.status, startedAt: game.startedAt, endedAt: game.endedAt, teams: game.teams.map(t=>{const{token,code,solved,wrong,submissions,...publicTeam}=t;return{...publicTeam,...(isTeacher?{code,solved,wrong}:viewerTeamId===t.id?{solved,wrong}:{}),submissions:isTeacher||viewerTeamId===t.id?(submissions||[]):[]}}), events: game.events }; }
function body(req) { return new Promise((resolve, reject) => { let s = ''; req.on('data', c => { s += c; if(s.length>4_000_000){reject(new Error('請求內容過大'));req.destroy()} }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } }); }); }
function tokenTeam(req) { const token = req.headers['x-team-token']; return Object.values(games).flatMap(g=>g.teams).find(t => t.token && t.token === token); }
const loginAttempts = new Map();
function loginBlocked(ip) { const now=Date.now(),a=(loginAttempts.get(ip)||[]).filter(t=>now-t<10*60_000);loginAttempts.set(ip,a);return a.length>=10; }
function coord(r, c) { return String.fromCharCode(65 + r) + (c + 1); }
function sameShape(a,b) { const normalize=cells=>{if(!Array.isArray(cells)||!cells.length||cells.some(c=>typeof c!=='string'||!/^[A-H][1-8]$/.test(c)))return null;const unique=[...new Set(cells)],points=unique.map(c=>({r:c.charCodeAt(0)-65,col:Number(c.slice(1))-1})),minR=Math.min(...points.map(p=>p.r)),minC=Math.min(...points.map(p=>p.col));return points.map(p=>`${p.r-minR}:${p.col-minC}`).sort()};const x=normalize(a),y=normalize(b);return !!x&&!!y&&x.length===y.length&&x.every((v,i)=>v===y[i]); }
const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function xmlEscape(s) { return String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
function workbook(state) { const rows1=[['班級','組別',...state.questions.map((_,i)=>`第${i+1}題`),'總分'],...state.teams.map(t=>[state.classCode,t.name,...state.questions.map((_,i)=>t.solved[i]?.points||0),t.total])]; const rows2=[['題號','組別','答題時間','是否答對','答錯次數','完成順序','本題得分'],...state.teams.flatMap(t=>t.submissions.map(s=>[`第${s.question+1}題`,t.name,new Date(s.time).toLocaleString('zh-TW'),s.correct?'是':'否',s.wrongCount,s.rank||'',s.points||0]))]; function sheet(name,rows){return `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${rows.map(row=>'<Row>'+row.map(v=>`<Cell><Data ss:Type="${typeof v==='number'?'Number':'String'}">${xmlEscape(v)}</Data></Cell>`).join('')+'</Row>').join('')}</Table></Worksheet>`} return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheet('成績總表',rows1)}${sheet('詳細紀錄',rows2)}</Workbook>`; }
const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}
  const url=new URL(req.url,'http://localhost'), requested=url.searchParams.get('class')||'701', classCode=/^70[1-7]$/.test(requested)?requested:'701';
  try {
    if(url.pathname==='/')return send(res,200,page,'text/html; charset=utf-8');
    if(url.pathname==='/api/state'&&req.method==='GET'){const team=tokenTeam(req),isTeacher=req.headers['x-teacher-token']===TEACHER_TOKEN;return send(res,200,pub(getGame(isTeacher?classCode:team?team.classCode:classCode),team?.id??null,isTeacher))}
    if(url.pathname==='/api/export'){if(req.headers['x-teacher-token']!==TEACHER_TOKEN)return send(res,401,{error:'請先通過教師登入。'});state=getGame(classCode);res.writeHead(200,{'Content-Type':'application/vnd.ms-excel; charset=utf-8','Content-Disposition':`attachment; filename="scores-${classCode}.xls"`,'Cache-Control':'no-store'});return res.end('\ufeff'+workbook(state))}
    if(url.pathname==='/api/login'&&req.method==='POST'){const ip=req.socket.remoteAddress||'unknown';if(loginBlocked(ip))return send(res,429,{error:'登入嘗試次數過多，請 10 分鐘後再試。'});const {code}=await body(req),team=Object.values(games).flatMap(g=>g.teams).find(t=>t.code===code);if(!team){loginAttempts.get(ip).push(Date.now());return send(res,401,{error:'密碼不正確，請確認老師提供的組別密碼。'});}if(team.token)return send(res,409,{error:'這組已在另一台裝置登入。如需換裝置，請先在原裝置離開小組。'});team.token=crypto.randomBytes(24).toString('hex');team.loggedIn=true;await persist();return send(res,200,{token:team.token,teamId:team.id,classCode:team.classCode})}
    if(url.pathname==='/api/teacher/login'&&req.method==='POST'){const ip=req.socket.remoteAddress||'unknown';if(loginBlocked(ip))return send(res,429,{error:'登入嘗試次數過多，請 10 分鐘後再試。'});let {password}=await body(req);if(password!==TEACHER_PASSWORD){let attempts=loginAttempts.get(ip)||[];attempts.push(Date.now());loginAttempts.set(ip,attempts);return send(res,401,{error:'教師密碼不正確。'});}loginAttempts.delete(ip);return send(res,200,{token:TEACHER_TOKEN})}
    if(url.pathname==='/api/logout'&&req.method==='POST'){let team=tokenTeam(req);if(team){team.token=null;team.loggedIn=false;persist()}return send(res,200,{ok:true})}
    if(url.pathname==='/api/answer'&&req.method==='POST'){let team=tokenTeam(req);if(!team)return send(res,401,{error:'登入已失效，請重新登入。'});let {cells=[]}=await body(req);state=getGame(team.classCode);if(state.status!=='active'||state.current<0)return send(res,409,{error:'請等老師開放題目。'});if(team.solved[state.current])return send(res,409,{error:'本題已完成，請等老師開放下一題。'});const submittedCells=Array.isArray(cells)?[...new Set(cells.filter(c=>typeof c==='string'&&/^[A-H][1-8]$/.test(c)))]:[];let got=submittedCells,ans=state.questions[state.current].answer,correct=sameShape(got,ans),time=Date.now();if(correct){let rank=state.events.filter(e=>e.question===state.current).length+1,points=Math.max(1,7-rank);team.solved[state.current]={time,rank,points};team.total+=points;state.events.push({question:state.current,teamId:team.id,rank,points,time});team.submissions.push({question:state.current,time,correct:true,cells:submittedCells,wrongCount:team.wrong[state.current]||0,rank,points})}else{team.wrong[state.current]=(team.wrong[state.current]||0)+1;team.submissions.push({question:state.current,time,correct:false,cells:submittedCells,wrongCount:team.wrong[state.current],rank:null,points:0})}await persist();return send(res,200,{correct})}
    if(url.pathname.startsWith('/api/control/')&&req.method==='POST'){if(req.headers['x-teacher-token']!==TEACHER_TOKEN)return send(res,401,{error:'請先通過教師登入。'});state=getGame(classCode);const action=url.pathname.split('/').pop();if(action==='start'){if(!state.questions.length)return send(res,400,{error:'請先建立至少一題。'});if(state.status==='setup'){state.status='active';state.current=0;state.startedAt=Date.now();state.endedAt=null}}else if(action==='next'){if(state.status!=='active')return send(res,409,{error:'目前不是進行中的比賽。'});if(state.current+1>=state.questions.length){state.status='ended';state.endedAt=Date.now()}else state.current++}else if(action==='end'){state.status='ended';state.endedAt=Date.now()}else if(action==='reset'){let old=state;state=fresh(classCode);state.questions=old.questions;state.teams.forEach(t=>{t.code=old.teams[t.id-1].code});state.title=old.title;state.className=old.className;state.classCode=classCode;games[classCode]=state}else if(action==='logout-all'){for(const team of state.teams){team.token=null;team.loggedIn=false}}else return send(res,404,{error:'找不到控制指令'});await persist();return send(res,200,{ok:true})}
    if(url.pathname==='/api/questions/add'&&req.method==='POST'){if(req.headers['x-teacher-token']!==TEACHER_TOKEN)return send(res,401,{error:'請先通過教師登入。'});let d=await body(req);state=getGame(classCode);if(state.status!=='setup')return send(res,409,{error:'請先重新開始新比賽，再編輯題目。'});if(!d.title||!d.prompt||!d.answer?.length)return send(res,400,{error:'請填寫題目名稱、說明和答案。'});if(!Number.isInteger(d.rows)||!Number.isInteger(d.cols)||d.rows<4||d.rows>8||d.cols<4||d.cols>8)return send(res,400,{error:'方格大小需介於 4 至 8。'});if(d.answer.some(c=>!/^[A-H][1-8]$/.test(c)||c.charCodeAt(0)-64>d.rows||Number(c.slice(1))>d.cols))return send(res,400,{error:'答案座標超出方格範圍，請修正答案。'});state.questions.push({title:d.title,prompt:d.prompt,rows:d.rows,cols:d.cols,answer:[...new Set(d.answer)],image:d.image||''});await persist();return send(res,200,{ok:true})}
    if(url.pathname==='/api/questions/delete'&&req.method==='POST'){if(req.headers['x-teacher-token']!==TEACHER_TOKEN)return send(res,401,{error:'請先通過教師登入。'});let {index}=await body(req);state=getGame(classCode);if(state.status!=='setup')return send(res,409,{error:'請先重新開始新比賽，再編輯題目。'});if(state.questions.length<=1)return send(res,409,{error:'至少保留一題。'});state.questions.splice(index,1);await persist();return send(res,200,{ok:true})}
    if(url.pathname==='/api/questions/dispatch'&&req.method==='POST'){if(req.headers['x-teacher-token']!==TEACHER_TOKEN)return send(res,401,{error:'請先通過教師登入。'});const {targetCodes=[]}=await body(req);state=getGame(classCode);if(state.status!=='setup')return send(res,409,{error:'題目來源班級必須尚未開始比賽。'});if(!Array.isArray(targetCodes)||targetCodes.length===0)return send(res,400,{error:'請至少選擇一個目標班級。'});const targets=[...new Set(targetCodes)];if(targets.some(c=>!classIds.includes(c)))return send(res,400,{error:'目標班級設定無效。'});const busy=targets.filter(c=>getGame(c).status!=='setup');if(busy.length)return send(res,409,{error:`以下班級尚有進行中或已完成的比賽，請先在該班重新開始新比賽：${busy.join('、')}`});for(const c of targets){const dest=getGame(c);dest.questions=JSON.parse(JSON.stringify(state.questions));if(c!==classCode)dest.title=state.title}await persist();return send(res,200,{ok:true,count:targets.length,classes:targets})}
    if(url.pathname==='/api/config'&&req.method==='POST'){if(req.headers['x-teacher-token']!==TEACHER_TOKEN)return send(res,401,{error:'請先通過教師登入。'});if(!games[classCode])return send(res,404,{error:'找不到班級'});if(getGame(classCode).status!=='setup')return send(res,409,{error:'請先重新開始新比賽，再修改設定。'});let d=await body(req);state=getGame(classCode);if(d.title)state.title=d.title.slice(0,80);if(d.className)state.className=d.className.slice(0,40);await persist();return send(res,200,{ok:true})}
    return send(res,404,{error:'找不到頁面'})
  }catch(e){console.error(e);return send(res,500,{error:'伺服器發生錯誤'})}
});initializeStorage().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log('三視圖挑戰賽已啟動'))).catch(error=>{console.error('資料庫初始化失敗',error);process.exit(1)});

/* 出席簽到 QR：畫面（老師主持台＋投影 QR＋學生手機端）
   老師資料 localStorage 前綴 atq.：courses（課程清單）、course.<id>（名單、堂次、簽到紀錄、規則、房間代碼與現場碼祕密）、cur、cfg、tkey.<碼>、fold、fs、warnSeen、marquee。
   學生：atq.me（自己的學號姓名，下次自動帶入）、atq.sid.<碼>（手機代號，全數字）。
   連線借用創業島轉播站的教室模式（room=SIGN<6碼>&cls=1），Worker 沒改。 */
(function(){
'use strict';
var P = window.ATQ, IO = window.ATQIO, $ = function(id){ return document.getElementById(id); };
var QS = new URLSearchParams(location.search);
var JOIN = P.cleanRoom(QS.get('join') || '');
var PFX = 'atq.', ONLINE = 'https://m255525.github.io/attendance-qr/';
var PRESENCE = QS.get('presence') || 'wss://startup-island-presence.content-workflow.workers.dev/ws';
var ROOM_PREFIX = 'SIGN';
var BADGE = 'https://visitor-badge.laobi.icu/badge?page_id=m255525.attendanceqr';
var JOINPAGE = QS.has('join');   // 學生端（含沒帶代碼的「🎓 學生登入」入口頁）
var LOBBY_URL = PRESENCE.replace(/^ws/, 'http').replace(/\/ws(\?.*)?$/, '/lobby') + '?k=SIGN';
function cleanPw(s){ return P.FW(s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
function ssGet(k){ try{ return sessionStorage.getItem(PFX + k); }catch(e){ return null; } }
function ssSet(k, v){ try{ sessionStorage.setItem(PFX + k, v); }catch(e){} }

function lsGet(k){ try{ return localStorage.getItem(PFX + k); }catch(e){ return null; } }
function lsSet(k, v){ try{ localStorage.setItem(PFX + k, v); return true; }catch(e){ return false; } }
function lsDel(k){ try{ localStorage.removeItem(PFX + k); }catch(e){} }
function lsJson(k, d){ try{ var v = JSON.parse(lsGet(k)); return v == null ? d : v; }catch(e){ return d; } }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]; }); }
function randId(){ var s = ''; while(s.length < 12) s += P.cryptoInt(36).toString(36); return s; }
function digitId(){ var s = ''; while(s.length < 12) s += P.cryptoInt(10); return s; } // 學生手機代號只用數字：轉播站的不雅字詞過濾不會誤遮
var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
function now(){ return Date.now(); }

/* ---------- 共用 ---------- */
function openModal(h, wide){ $('modalBox').innerHTML = h; $('modalBox').className = wide ? 'wide' : ''; $('modal').classList.add('show'); }
function closeModal(){ $('modal').classList.remove('show'); }
var toastT;
function toast(s){ var t = document.querySelector('.toast'); if(!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = s; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function(){ t.hidden = true; }, 3000); }
function copyText(s, ok){ function fb(){ var t = document.createElement('textarea'); t.value = s; document.body.appendChild(t); t.select(); try{ document.execCommand('copy'); }catch(e){} t.remove(); } if(navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(s).catch(fb); else fb(); toast(ok || '已複製'); }
function saveBlob(name, blob){ var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
function safeName(s){ return String(s || '出席').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30); }
var AC = null;
function snd(kind){
  if(lsGet('mute') === '1') return;
  try{
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    ({ok:[880, 1175], late:[660, 523], bad:[300, 220]}[kind] || [440]).forEach(function(f, i){
      var t = AC.currentTime + i * .09, o = AC.createOscillator(), g = AC.createGain();
      o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(AC.destination);
      g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.001, t + .2); o.start(t); o.stop(t + .22);
    });
  }catch(e){}
}

/* ---------- 連線（複製自 classroom-qa-wall，房間前綴改 SIGN） ---------- */
var NET = {ws:null, want:false, status:'off', code:'', role:JOINPAGE ? 'S' : 'T', pw:'', myId:randId(), peers:{}, retry:0, ping:0, q:[], qBusy:false, last:null, state:'T|0i00', tkey:''};
function netStart(code, pw){
  NET.want = true; NET.code = code; NET.retry = 0; NET.pw = cleanPw(pw);
  if(NET.role === 'T'){ NET.tkey = lsGet('tkey.' + code); if(!NET.tkey){ NET.tkey = randId() + randId(); lsSet('tkey.' + code, NET.tkey); } }
  else { NET.myId = lsGet('sid.' + code) || digitId(); lsSet('sid.' + code, NET.myId); }
  netConnect();
}
function netStop(closeRoom){
  var ws0 = NET.ws;
  if(closeRoom && NET.role === 'T' && ws0 && ws0.readyState === 1) try{ ws0.send('{"t":"close"}'); }catch(e){}
  NET.want = false; clearTimeout(NET.rt); clearInterval(NET.ping); NET.ws = null; NET.status = 'off'; NET.peers = {}; NET.q = [];
  if(ws0) try{ ws0.close(); }catch(e){}
  netPaint();
}
function netConnect(){
  if(!NET.want) return;
  var q = 'room=' + ROOM_PREFIX + NET.code + '&cls=1' + (NET.role === 'T' ? '&tkey=' + NET.tkey : '') + (NET.pw ? '&pw=' + NET.pw : ''), ws;
  try{ ws = new WebSocket(PRESENCE + '?' + q); }catch(e){ netRetry(); return; }
  NET.ws = ws; NET.status = 'wait'; netPaint();
  ws.onopen = function(){
    if(NET.ws !== ws) return;
    NET.status = 'on'; NET.retry = 0;
    ws.send(JSON.stringify({t:'hello', id:NET.myId, name:NET.role === 'T' ? NET.state : 'S', gx:0, gy:0}));
    clearInterval(NET.ping); NET.ping = setInterval(function(){ if(NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"ping"}'); }, 25000);
    if(NET.role === 'T'){ syncSoon(500); sendRoomInfo(); }
    netPaint(); pump();
  };
  ws.onmessage = function(ev){ if(NET.ws !== ws) return; var m; try{ m = JSON.parse(ev.data); }catch(e){ return; } onNet(m); };
  ws.onclose = function(ev){
    if(NET.ws !== ws) return; NET.status = 'off'; NET.ws = null; clearInterval(NET.ping); NET.qBusy = false;
    var code = ev.code;
    if(NET.role === 'S' && (code === 4004 || code === 4005)){ S.closed = code; NET.want = false; renderStu(); return; }
    if(NET.role === 'S' && code === 4003){ S.needPw = true; S.pwBad = !!NET.pw; NET.want = false; renderStu(); return; }
    if(code === 4001 && NET.role === 'T'){ toast('這個代碼正由另一台電腦或分頁當主持人，已改用新代碼'); netStop(); C.room = P.newRoom(); saveC(); netStart(C.room, C.cls.pw); QR.tok = ''; render(); return; }
    if(code === 4002){ NET.myId = NET.role === 'S' ? digitId() : randId(); if(NET.role === 'S') lsSet('sid.' + NET.code, NET.myId); }
    netPaint(); netRetry();
  };
  ws.onerror = function(){};
}
function netRetry(){ if(!NET.want) return; NET.retry++; clearTimeout(NET.rt); NET.rt = setTimeout(netConnect, Math.min(30000, 1500 * Math.pow(2, NET.retry - 1))); }
function send(o){ if(NET.ws && NET.ws.readyState === 1){ NET.ws.send(JSON.stringify(o)); return true; } return false; }
function setName(name){ if(NET.state === name) return; NET.state = name; send({t:'look', name:name}); }
function queueChats(list, tag, first){
  if(tag) NET.q = NET.q.filter(function(x){ return x.tag !== tag; });
  var items = list.map(function(t){ return {t:t, tag:tag}; });
  NET.q = first ? items.concat(NET.q) : NET.q.concat(items);
  pump();
}
function pump(){
  if(NET.qBusy || !NET.q.length || NET.status !== 'on') return;
  var it = NET.q.shift(); NET.last = it;
  if(!send({t:'chat', text:it.t})){ NET.q.unshift(it); return; }
  NET.qBusy = true; setTimeout(function(){ NET.qBusy = false; pump(); }, 2700);
}
function onNet(m){
  if(m.t === 'snapshot'){
    NET.peers = {}; (m.peers || []).forEach(function(p){ NET.peers[p.id] = String(p.name || ''); });
    if(NET.role === 'T') (m.chat || []).forEach(function(c){ T.onChat(c); });
    else { S.onPeers(); (m.chat || []).forEach(function(c){ S.onChat(c); }); }
  } else if(m.t === 'join' && m.peer){ NET.peers[m.peer.id] = String(m.peer.name || ''); if(NET.role === 'T'){ if(!/^T\|/.test(String(m.peer.name || ''))) syncSoon(2500); } else S.onPeers(); }
  else if(m.t === 'look'){ NET.peers[m.id] = String(m.name || ''); if(NET.role === 'S') S.onPeers(); }
  else if(m.t === 'leave'){ delete NET.peers[m.id]; }
  else if(m.t === 'chat'){ if(NET.role === 'T') T.onChat(m); else S.onChat(m); }
  else if(m.t === 'chatSlow'){ if(NET.last) NET.q.unshift(NET.last); NET.qBusy = true; setTimeout(function(){ NET.qBusy = false; pump(); }, (m.wait || 1000) + 300); }
  netPaint();
}
function netPaint(){ var el = $('netChip'); if(el) el.innerHTML = netChipHtml(); }
function netChipHtml(){
  var st = NET.status === 'on' ? 'on' : NET.status === 'wait' ? 'wait' : '';
  if(NET.role === 'T') return '<span class="dot ' + st + '"></span>' + (NET.want ? '📱 ' + esc(NET.code) + '・' + Object.keys(NET.peers).filter(function(k){ return !/^T\|/.test(NET.peers[k]); }).length + ' 支手機在線' : '📱 尚未開放簽到');
  return '<span class="dot ' + st + '"></span>' + (NET.status === 'on' ? '已連線' : NET.status === 'wait' ? '連線中…' : '未連線');
}
var syncT;
function syncSoon(ms){ clearTimeout(syncT); syncT = setTimeout(function(){ if(NET.role === 'T' && C) { var s = curSess(); queueChats([P.encRoom(C.name, s ? (s.title || P.mdw(s.date)) : '')], 'sync'); } }, ms || 500); }

/* ============================ 老師 ============================ */
var CFG = Object.assign({rot:20, win:120, fs:'m'}, lsJson('cfg', {}));
function saveCfg(){ lsSet('cfg', JSON.stringify(CFG)); }
var COURSES = lsJson('courses', []);
var C = null, L = {open:false, mode:'in', ack:[], ackT:0, seen:{}};
function newCourse(base){
  var c = Object.assign({id:'c' + randId().slice(0, 8), name:'新課程', unit:'', rule:Object.assign({}, P.DEF_RULE), roster:[], sessions:[]}, base || {});
  c.room = P.newRoom(); c.secret = P.newSecret(); c.cur = c.sessions[0] ? c.sessions[0].id : '';
  return normC(c);
}
// 補齊欄位（新建、範例、讀檔、還原都走這裡）
function normC(c){ c.rule = Object.assign({}, P.DEF_RULE, c.rule); c.roster = c.roster || []; c.sessions = (c.sessions || []).map(function(s){ s.recs = s.recs || {}; s.devs = s.devs || {}; s.pending = s.pending || []; s.dupes = s.dupes || []; s.seen = s.seen || []; return s; }); if(!c.room) c.room = P.newRoom(); if(!c.secret) c.secret = P.newSecret(); c.cls = Object.assign({name:'', pub:true, pw:''}, c.cls); return c; }
function loadC(id){ var c = lsJson('course.' + id, null); return c ? normC(c) : null; }
function saveC(){ if(!C) return; if(!lsSet('course.' + C.id, JSON.stringify(C))) toast('瀏覽器空間不足，紀錄可能沒存到，請先匯出備份'); var i = COURSES.findIndex(function(x){ return x.id === C.id; }); var meta = {id:C.id, name:C.name}; if(i < 0) COURSES.push(meta); else COURSES[i] = meta; lsSet('courses', JSON.stringify(COURSES)); lsSet('cur', C.id); ssSet('cur', C.id); }
function curSess(){ return C && (C.sessions.find(function(s){ return s.id === C.cur; }) || C.sessions[0]) || null; }
function sessIdx(){ return C ? Math.max(0, C.sessions.indexOf(curSess())) : 0; }
function personOf(key){ var p = C.roster.find(function(x){ return P.keyOf(x) === key; }); if(p) return p; var s = C.sessions.find(function(x){ return x.recs[key] && x.recs[key].extra; }); return s ? s.recs[key].extra : {no:'', name:key.slice(2)}; }

var T = {
  onChat:function(m){
    if(!C || !m || m.id === NET.myId) return;
    var d = P.decCheck(m.text); if(!d) return;
    var s = curSess(); if(!s) return;
    var sig = m.id + '|' + m.at;
    if(L.seen[sig] || s.seen.indexOf(sig) >= 0) return; // 轉播站重播的舊訊息
    L.seen[sig] = 1; s.seen.push(sig); if(s.seen.length > 400) s.seen = s.seen.slice(-300);
    var c = T.handle(s, d, m.id, m.at || now());
    T.ack(m.id, c);
    saveC(); T.paintSoon();
    snd(P.ACK_OK[c] ? (c === 2 || c === 8 ? 'late' : 'ok') : 'bad');
  },
  handle:function(s, d, dev, at){
    if(!L.open) return 0;
    var p = P.match(C.roster, d.no, d.name), key;
    if(!p && !C.roster.length && (d.no || d.name)){ p = {no:d.no, name:d.name, idno:'', group:'自行簽到'}; C.roster.push(p); } // 沒有名單：誰簽到就加進名單
    if(!p){
      if(!s.pending.some(function(x){ return x.dev === dev && x.no === d.no && x.name === d.name; })) s.pending.push({dev:dev, no:d.no, name:d.name, at:at, mode:d.mode, ok:P.tokenOk(C.secret, d.tok, at, CFG.rot, CFG.win, s.id)});
      return 6;
    }
    key = P.keyOf(p);
    var other = s.devs[dev];
    if(other && other !== key){ s.dupes.push({dev:dev, key:key, other:other, at:at}); return 5; }
    var rec = s.recs[key] || {};
    if(d.mode === 'in' && rec.in) return 3;
    if(d.mode === 'out' && rec.out) return 3;
    if(!P.tokenOk(C.secret, d.tok, at, CFG.rot, CFG.win, s.id)) return 4;
    s.devs[dev] = key; rec.dev = dev; rec.how = 'qr';
    if(d.mode === 'in'){ rec.in = at; s.recs[key] = rec; return P.statusOf(rec, s, C.rule) === 'late' ? 2 : 1; }
    var had = !!rec.in; rec.out = at; s.recs[key] = rec;
    if(!had) return 9;
    var st = P.statusOf(rec, s, C.rule);
    return st === 'early' || st === 'lateearly' ? 8 : 7;
  },
  ack:function(id, c){ L.ack.push({id:id, c:c}); clearTimeout(L.ackT); L.ackT = setTimeout(function(){ var a = L.ack; L.ack = []; queueChats(P.encAcks(a), null, true); }, 350); },
  paintT:0,
  paintSoon:function(){ clearTimeout(T.paintT); T.paintT = setTimeout(function(){ if(!JOIN) paintMain(); }, 120); },
};
function pushState(){ setName(P.encState(L.open, L.mode, sessIdx())); }
function startCheck(){
  var s = curSess(); if(!s){ toast('請先新增一堂課'); return; }
  askTabs().then(function(list){
    if(list.some(function(x){ return x.live === C.id; })){ openModal('<h2>⛔ 這個課程正在另一個分頁簽到</h2><p>同一個課程一次只能在一個分頁開始簽到。請回到那個分頁，或在這裡換一個課程（不同課程可以各開一個分頁同時簽到）。</p><div class="stack"><button type="button" class="btn" data-act="close">知道了</button></div>'); return; }
    L.open = true; s.closed = false; saveC(); tabSay();
    NET.state = P.encState(true, L.mode, sessIdx());
    netStart(C.room, C.cls.pw); syncSoon(800); render(); startTicker();
  });
}
function stopCheck(){
  var s = curSess(); L.open = false; if(s && L.mode === 'in' && now() > P.ts(s.date, s.start)) s.closed = true; saveC();
  netStop(true); lsDel('tkey.' + C.room); C.room = P.newRoom(); QR.tok = ''; saveC(); tabSay(); render(); setTimeout(fetchLobby, 1500); toast('已結束簽到，學生手機上的連結已失效');
}
function sendRoomInfo(){ if(NET.role !== 'T' || !C) return; send({t:'room', name:C.cls.name || C.name, pub:!!C.cls.pub}); setTimeout(fetchLobby, 1500); }

/* ---------- 多個分頁：每個分頁一個課程，同一個課程只能在一個分頁簽到（BroadcastChannel） ---------- */
var TAB = randId(), OTHER = {}, ASK = {}, BC = null;
try{
  BC = new BroadcastChannel('atq-tab');
  BC.onmessage = function(e){
    var m = e.data || {};
    if(m.ask){ BC.postMessage({re:m.ask, tab:TAB, live:L.open && C ? C.id : ''}); return; }
    if(m.re){ if(ASK[m.re]) ASK[m.re].push(m); return; }
    if(m.tab){ Object.keys(OTHER).forEach(function(k){ if(OTHER[k] === m.tab) delete OTHER[k]; }); if(m.live) OTHER[m.live] = m.tab; if(!JOINPAGE && C && !$('modal').classList.contains('show')) render(); }
  };
}catch(e){ BC = null; }
function tabSay(){ if(BC) try{ BC.postMessage({tab:TAB, live:L.open && C ? C.id : ''}); }catch(e){} }
function askTabs(){
  return new Promise(function(ok){
    if(!BC) return ok([]);
    var n = randId(); ASK[n] = []; BC.postMessage({ask:n});
    setTimeout(function(){ var r = ASK[n] || []; delete ASK[n]; OTHER = {}; r.forEach(function(x){ if(x.live) OTHER[x.live] = x.tab; }); ok(r); }, 350);
  });
}
function courseLive(id){ return (L.open && C && C.id === id) || !!OTHER[id]; }
function liveAnywhere(){ return L.open || Object.keys(OTHER).length > 0; }
function roOther(){ return !L.open && C && !!OTHER[C.id]; }
function blocked(msg){ openModal('<h2>⛔ 簽到中，不能這樣做</h2><p>' + msg + '</p><p class="small">請先在簽到中的分頁按「⏹ 結束簽到」。</p><div class="stack"><button type="button" class="btn" data-act="close">知道了</button></div>'); }
window.addEventListener('pagehide', function(){ if(L.open){ L.open = false; tabSay(); } });
window.addEventListener('storage', function(e){
  if(JOINPAGE || !C || !e.key) return;
  if(e.key === PFX + 'adm'){ ADM = lsJson('adm', null); return; }
  if(e.key === PFX + 'courses'){ COURSES = lsJson('courses', []); }
  if(!L.open && (e.key === PFX + 'course.' + C.id || e.key === PFX + 'courses')){ var c = loadC(C.id); if(c){ C = c; } if(!$('modal').classList.contains('show')) render(); }
});

/* ---------- 管理密碼（一台電腦一組；刪除、清除、還原要輸入；名單保護：看名單、總表、匯出要輸入，解鎖 10 分鐘） ---------- */
var ADM = lsJson('adm', null), UNLOCK = 0, BADPIN = {n:0, until:0}, PIN_CB = null, SURE_CB = null;
function hashPin(pin, salt){
  var t = 'atq|' + salt + '|' + pin;
  if(window.crypto && crypto.subtle && window.isSecureContext) return crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)).then(function(b){ return Array.from(new Uint8Array(b)).map(function(x){ return x.toString(16).padStart(2, '0'); }).join(''); });
  return Promise.resolve('f' + P.fnv(t).toString(16) + P.fnv(t + '#').toString(16));
}
function askPin(title, fn){
  if(!ADM){ fn(); return; }
  PIN_CB = fn;
  openModal('<h2>🔐 ' + esc(title) + '</h2><p>請輸入管理密碼。</p><input id="pinIn" class="pinin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" aria-label="管理密碼"><p class="small" id="pinMsg"></p><div class="stack"><button type="button" class="btn" data-act="pinOk">確定</button><button type="button" class="btn alt" data-act="close">取消</button></div>');
  setTimeout(function(){ var el = $('pinIn'); if(el) el.focus(); }, 30);
}
function pinOk(){
  var el = $('pinIn'); if(!el || !ADM) return;
  if(now() < BADPIN.until){ $('pinMsg').textContent = '錯太多次了，請 ' + Math.ceil((BADPIN.until - now()) / 1000) + ' 秒後再試'; return; }
  hashPin(el.value, ADM.salt).then(function(h){
    if(h === ADM.hash){ BADPIN.n = 0; UNLOCK = now() + 10 * 60000; var f = PIN_CB; PIN_CB = null; closeModal(); if(!JOINPAGE) paintTop(); if(f) f(); }
    else { BADPIN.n++; if(BADPIN.n >= 5){ BADPIN.until = now() + 60000; BADPIN.n = 0; } el.value = ''; $('pinMsg').textContent = '密碼不對' + (BADPIN.until > now() ? '，請 60 秒後再試' : ''); }
  });
}
function sureOr(title, fn){
  if(ADM){ askPin(title, fn); return; }
  SURE_CB = fn;
  openModal('<h2>' + esc(title) + '？</h2><p>這個動作不能復原。</p><div class="stack"><button type="button" class="btn red" data-act="sureOk">確定</button><button type="button" class="btn alt" data-act="close">取消</button></div>');
}
function guardView(title, fn){ if(ADM && ADM.list && now() > UNLOCK) askPin(title, fn); else fn(); }
function admChip(){ return ADM && ADM.list && now() < UNLOCK ? '<button type="button" class="ibtn" id="admChip" data-act="admLock" title="名單保護已暫時解鎖，按一下立刻上鎖">🔓 已解鎖・上鎖</button>' : ''; }
function paintTop(){ var h = document.querySelector('header.top'); if(h){ var d = document.createElement('div'); d.innerHTML = header(); h.replaceWith(d.querySelector('header.top')); paintLobby(); } }
setInterval(function(){ if(!JOINPAGE && UNLOCK && now() > UNLOCK && $('admChip')){ UNLOCK = 0; paintTop(); } }, 15000);
function admSection(){
  if(!ADM) return '<p class="small">設了之後：刪除課程、清除全部、還原備份、清空名單、刪除有紀錄的堂次都要輸入；勾「名單保護」的話，看名單、總表、匯出也要輸入（輸入一次 10 分鐘內免再輸入）。一台電腦一組，只存雜湊。</p>' +
    '<div class="row3"><label class="fld">管理密碼（4～8 位數字）<input id="admN1" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label><label class="fld">再輸入一次<input id="admN2" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label></div>' +
    '<label class="chk"><input type="checkbox" id="admList" checked>名單保護（看名單、總表、匯出也要輸入）</label><p class="small" id="admMsg"></p><div class="stack"><button type="button" class="btn" data-act="admSet">設定管理密碼</button></div>';
  return '<p>已設定管理密碼' + (ADM.list ? '，名單保護開著' : '，名單保護關著') + '。</p><div class="stack"><button type="button" class="btn alt sm" data-act="admChange">改密碼</button><button type="button" class="btn alt sm" data-act="admListT">' + (ADM.list ? '關掉' : '打開') + '名單保護</button><button type="button" class="btn alt sm" data-act="admOff">取消管理密碼</button><button type="button" class="btn red sm" data-act="admForget">忘記密碼</button></div>';
}

/* ---------- 教室大廳（轉播站 /lobby?k=SIGN，只列公開的簽到教室） ---------- */
var LOB = {rooms:[], at:0, err:false, t:0};
function fetchLobby(){ return fetch(LOBBY_URL, {cache:'no-store'}).then(function(r){ return r.json(); }).then(function(d){ LOB.rooms = Array.isArray(d.rooms) ? d.rooms : []; LOB.at = now(); LOB.err = false; paintLobby(); }).catch(function(){ LOB.err = true; paintLobby(); }); }
function startLobby(){ fetchLobby(); clearInterval(LOB.t); LOB.t = setInterval(function(){ if(!document.hidden) fetchLobby(); }, 20000); }
function lobbyListHtml(){
  if(!LOB.at) return LOB.err ? '<p class="small">連不上教室大廳，請用老師給的 6 碼教室代碼加入。</p>' : '<p class="small">讀取中…</p>';
  if(!LOB.rooms.length) return '<p class="small">目前沒有公開的簽到教室。老師按「開始簽到」後才會出現。</p>';
  return '<div class="lob">' + LOB.rooms.map(function(r){ return '<button type="button" class="lrow" data-lob="' + esc(r.code) + '" data-lpw="' + (r.pw ? 1 : 0) + '" data-lname="' + esc(r.name) + '"><b>' + (r.pw ? '🔒 ' : '') + esc(r.name) + '</b><span>' + (+r.n || 0) + ' 支手機在線</span></button>'; }).join('') + '</div>';
}
function paintLobby(){
  var c = $('lobbyChip'); if(c){ c.textContent = '🏫 ' + (LOB.at ? LOB.rooms.length + ' 間教室' : '教室大廳'); c.title = LOB.rooms.map(function(x){ return x.name; }).join('、') || '目前沒有公開的簽到教室'; }
  document.querySelectorAll('[data-lobbylist]').forEach(function(l){ l.innerHTML = lobbyListHtml(); });
}
function openLobby(){ openModal('<h2>🏫 簽到教室大廳</h2><p class="small">老師在「📝 課程設定」勾「公開在教室大廳」並按「▶ 開始簽到」，教室就會出現在這裡。</p><div data-lobbylist>' + lobbyListHtml() + '</div><div class="stack"><button type="button" class="btn alt" data-act="lobbyRefresh">🔄 重新整理</button><a class="btn alt" href="?join" target="_blank" rel="noopener">🎓 學生登入頁</a><button type="button" class="btn" data-act="close">關閉</button></div>', true); fetchLobby(); }
function goRoom(code, pw){ var u = location.pathname + '?join=' + code + (pw ? '&pw=' + pw : ''); if(JOINPAGE) location.href = u; else window.open(u, '_blank'); }
var LPICK = null;
function lobbyPick(code, needPw, name){
  if(!needPw){ goRoom(code, ''); return; }
  LPICK = code;
  openModal('<h2>🔒 ' + esc(name) + '</h2><p>請輸入老師公布的教室密碼。</p><input id="lobbyPwIn" class="pinin" maxlength="8" autocomplete="off" autocapitalize="characters" aria-label="教室密碼" style="text-transform:uppercase"><div class="stack"><button type="button" class="btn green" data-act="lobbyPwOk">進入教室</button><button type="button" class="btn alt" data-act="close">取消</button></div>');
  setTimeout(function(){ var el = $('lobbyPwIn'); if(el) el.focus(); }, 30);
}

/* ---------- 現場碼與 QR ---------- */
var qrLib = null, QR = {tok:'', url:'', img:''}, tick = 0;
function loadQRLib(){
  if(window.QRCode) return Promise.resolve();
  if(!qrLib) qrLib = new Promise(function(ok, no){ var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'; s.onload = ok; s.onerror = function(){ qrLib = null; no(new Error('QR 元件載入失敗（需要網路）')); }; document.head.appendChild(s); });
  return qrLib;
}
function joinUrl(code, tok){ var here = location.protocol === 'https:' && location.hostname === 'm255525.github.io', pw = C && C.cls ? C.cls.pw : ''; return (here ? location.origin + location.pathname : ONLINE) + '?join=' + code + (tok ? '&k=' + tok : '') + (pw ? '&pw=' + pw : ''); }
function startTicker(){ clearInterval(tick); tick = setInterval(updQR, 1000); updQR(); }
function updQR(){
  if(!L.open || !C){ clearInterval(tick); return; }
  var s = curSess(), t = P.curToken(C.secret, now(), CFG.rot, s.id);
  document.querySelectorAll('[data-left]').forEach(function(el){ el.textContent = CFG.rot > 0 ? t.left + ' 秒後換碼' : '固定不換'; });
  document.querySelectorAll('.bar i').forEach(function(el){ el.style.width = CFG.rot > 0 ? (t.left / CFG.rot * 100) + '%' : '100%'; });
  if(t.tok !== QR.tok){
    QR.tok = t.tok; QR.url = joinUrl(C.room, t.tok);
    loadQRLib().then(function(){
      var box = $('qrTmp'); box.innerHTML = '';
      new window.QRCode(box, {text:QR.url, width:600, height:600, colorDark:'#000', colorLight:'#fff', correctLevel:window.QRCode.CorrectLevel.M});
      var cv = box.querySelector('canvas'); QR.img = cv ? cv.toDataURL('image/png') : '';
      document.querySelectorAll('img[data-qr]').forEach(function(im){ im.src = QR.img; });
    }).catch(function(e){ toast(e.message); });
  }
  // 畫面每次重畫都要補回現場碼與網址（不能只在換碼時寫）
  document.querySelectorAll('[data-tok]').forEach(function(el){ el.textContent = t.tok; });
  document.querySelectorAll('[data-url]').forEach(function(el){ el.textContent = joinUrl(C.room, '').replace(/^https?:\/\//, ''); });
}

/* ---------- 畫面 ---------- */
function header(){
  return '<header class="top"><div class="clock" aria-hidden="true"><span id="clockNow">' + P.hm(now()) + '</span></div><h1>出席簽到 QR <small>掃碼簽到・遲到早退・出席時數</small></h1>' +
    '<span class="chip" id="netChip">' + netChipHtml() + '</span><button type="button" class="ibtn" id="lobbyChip" data-act="lobby" title="公開的簽到教室">🏫 ' + (LOB.at ? LOB.rooms.length + ' 間教室' : '教室大廳') + '</button><a class="ibtn" href="?join" target="_blank" rel="noopener" title="學生用：選教室、輸入密碼進入">🎓 學生登入</a>' + admChip() + '<a class="ibtn" href="manual.html">📖 操作手冊</a><button class="ibtn" type="button" data-act="settings" aria-label="常用設定">⚙</button></header>' +
    '<p class="warn-line">名單與簽到紀錄只存在這台電腦；掃碼簽到防不了所有代簽，請搭配現場點名。<button type="button" data-act="warn">⚠ 使用警語</button></p>';
}
function footer(){
  return '<footer class="foot">👤 創作者 Mark Tsai（蔡豐全）<a href="mailto:tsaimark@gmail.com">tsaimark@gmail.com</a><br><a href="manual.html">📖 操作手冊</a><a href="manual.html#creator">👤 創作者資訊</a><a href="#" data-act="warn">⚠ 使用警語</a>' +
    (standalone ? '' : '<a href="#" data-act="install">📲 加入主畫面</a>') + '<br><img src="' + BADGE + '" alt="訪客次數" height="20" loading="lazy" style="vertical-align:middle;margin-top:.4rem"></footer>';
}
function render(){
  if(JOINPAGE){ if(JOIN) renderStu(); else renderEntry(); return; }
  var s = curSess();
  $('app').innerHTML = header() +
    '<div class="cbar"><label class="sr" for="courseSel">課程</label><select id="courseSel" aria-label="課程">' + COURSES.map(function(c){ return '<option value="' + c.id + '"' + (C && c.id === C.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>' +
    '<button type="button" class="btn alt sm" data-act="newCourse">＋ 新課程</button><button type="button" class="btn alt sm" data-act="courseSet">📝 課程設定</button><button type="button" class="btn alt sm" data-act="roster">👥 名單（' + C.roster.length + '）</button>' +
    '<button type="button" class="btn alt sm" data-act="summary">📊 總表</button><button type="button" class="btn alt sm" data-act="export">⬇ 匯出・列印</button></div>' +
    (roOther() ? '<div class="alert warn" id="roBanner">👀 這個課程正在<b>另一個分頁</b>簽到中，這裡只能看（會自動更新）；要修改請回到那個分頁。</div>' : '') +
    '<div class="work"><aside class="sess" id="sessList"></aside><section class="main" id="main"></section></div>' + footer();
  paintSessions(); paintMain();
}
function paintSessions(){
  var el = $('sessList'); if(!el) return;
  el.innerHTML = '<h2>堂次</h2>' + C.sessions.map(function(s, i){
    var c = P.countSess(C, s, now());
    return '<button type="button" class="srow' + (s.id === C.cur ? ' on' : '') + '" data-sess="' + s.id + '"><b>' + (i + 1) + '. ' + esc(s.title || '第 ' + (i + 1) + ' 堂') + '</b><span>' + esc(P.mdw(s.date)) + ' ' + esc(s.start) + '–' + esc(s.end) + '・' + P.sessHours(s) + ' 小時</span><span class="cnt">到 ' + c.arrived + '／' + C.roster.length + (c.late + c.lateearly ? '・遲 ' + (c.late + c.lateearly) : '') + (c.absent ? '・缺 ' + c.absent : '') + '</span></button>';
  }).join('') + '<button type="button" class="btn green sm" data-act="addSess" style="width:100%">＋ 新增一堂</button>';
}
function stChip(st, rec, s){
  var t = P.ST[st].n;
  if(st === 'late' || st === 'lateearly') t += ' ' + P.lateMin(rec, s) + ' 分';
  if(st === 'early') t += ' ' + P.earlyMin(rec, s) + ' 分';
  return '<span class="st st-' + st + '">' + esc(t) + '</span>';
}
function paintMain(){
  var el = $('main'); if(!el) return;
  var s = curSess();
  if(!s){ el.innerHTML = '<div class="empty"><b>還沒有堂次</b>按左邊「＋ 新增一堂」，填日期與上課時間。</div>'; return; }
  var c = P.countSess(C, s, now()), h = '';
  h += '<div class="shead"><div><h2>' + esc(s.title || '這一堂') + '</h2><p class="small">' + esc(P.mdw(s.date)) + ' ' + esc(s.start) + '–' + esc(s.end) + '・' + P.sessHours(s) + ' 小時・遲到寬限 ' + C.rule.late + ' 分・早退寬限 ' + C.rule.early + ' 分</p></div>' +
    '<div class="stack">' + (L.open ? '<button type="button" class="btn red" data-act="stop">⏹ 結束簽到</button>' : '<button type="button" class="btn green big" data-act="start">▶ 開始簽到</button>') +
    '<span class="seg" role="group" aria-label="簽到或簽退"><button type="button" data-mode="in" aria-pressed="' + (L.mode === 'in') + '">簽到</button><button type="button" data-mode="out" aria-pressed="' + (L.mode === 'out') + '">簽退</button></span>' +
    '<button type="button" class="btn alt sm" data-act="editSess">📝 修改這堂</button></div></div>';
  if(L.open){
    var t = P.curToken(C.secret, now(), CFG.rot, s.id);
    h += '<div class="qrpanel"><img data-qr alt="簽到 QR code" src="' + (QR.img || '') + '"><div class="qrinfo"><div class="mode ' + L.mode + '">' + (L.mode === 'out' ? '簽退中' : '簽到中') + '</div>' +
      '<div class="tok">現場碼 <b data-tok>' + t.tok + '</b></div><div class="bar"><i></i></div><div class="small" data-left></div>' +
      '<div class="small">🏫 ' + esc(C.cls.name || C.name) + '・教室代碼 <b>' + esc(C.room) + '</b>' + (C.cls.pw ? '・密碼 <b>' + esc(C.cls.pw) + '</b>' : '') + (C.cls.pub ? '・公開在大廳' : '・不公開') + '</div><div class="small">網址 <span data-url></span></div>' +
      '<div class="stack"><button type="button" class="btn" data-act="proj">⛶ 投影 QR</button><button type="button" class="btn alt sm" data-act="copyJoin">複製連結</button></div></div></div>';
  } else h += '<div class="hint">按「▶ 開始簽到」後會出現 QR code，投影給學生用手機相機掃描。' + (C.roster.length ? '' : '<br>還沒有名單也可以開始：誰簽到就自動加進名單；有名單的話，名單外的人要老師確認。') + '</div>';
  h += '<div class="counts"><span>已到 <b>' + c.arrived + '</b>／' + C.roster.length + '</span><span class="lt">遲到 <b>' + (c.late + c.lateearly) + '</b></span><span class="ea">早退 <b>' + (c.early + c.lateearly) + '</b></span><span>請假 <b>' + (c.leave + c.official) + '</b></span><span class="ab">' + (c.absent ? '缺席' : '未到') + ' <b>' + (c.absent + c.none) + '</b></span></div>';
  if(s.pending.length) h += '<div class="alert warn"><b>❓ 名單上找不到（' + s.pending.length + '）</b>' + s.pending.map(function(x, i){ return '<div class="prow">' + esc(x.no || '（沒填學號）') + '　' + esc(x.name) + '　' + P.hm(x.at) + (x.ok ? '' : '・現場碼已過期') + '<span class="sp"></span><button type="button" class="btn sm" data-pok="' + i + '">加進名單並算出席</button><button type="button" class="btn alt sm" data-pno="' + i + '">不算</button></div>'; }).join('') + '</div>';
  if(s.dupes.length) h += '<div class="alert bad"><b>⚠ 同一支手機幫不同人簽到（' + s.dupes.length + '）</b>' + s.dupes.map(function(x, i){ return '<div class="prow">' + esc(personOf(x.other).name) + ' 的手機想再幫 ' + esc(personOf(x.key).name) + ' 簽到（' + P.hm(x.at) + '）<span class="sp"></span><button type="button" class="btn sm" data-dok="' + i + '">確認 ' + esc(personOf(x.key).name) + ' 有到</button><button type="button" class="btn alt sm" data-dno="' + i + '">不算</button></div>'; }).join('') + '</div>';
  var rows = C.roster.map(function(p){ var k = P.keyOf(p), rec = s.recs[k], st = P.statusOf(rec, s, C.rule, now()); return {p:p, k:k, rec:rec, st:st}; });
  var order = {pending:0, none:1, absent:2, late:3, lateearly:4, early:5, present:6, leave:7, official:8};
  if(L.open) rows.sort(function(a, b){ return (b.rec && b.rec.in || 0) - (a.rec && a.rec.in || 0); });
  h += '<div class="cards">' + (rows.length ? rows.map(function(r){
    return '<button type="button" class="tcard st-' + r.st + '" data-who="' + esc(r.k) + '"><span class="nm">' + esc(r.p.name || r.p.no) + '</span><span class="no">' + esc(r.p.no) + (r.p.group ? '・' + esc(r.p.group) : '') + '</span>' +
      '<span class="punch"><i>IN</i>' + (r.rec && r.rec.in ? P.hm(r.rec.in) : '--:--') + '<i>OUT</i>' + (r.rec && r.rec.out ? P.hm(r.rec.out) : '--:--') + '</span>' + stChip(r.st, r.rec, s) + (r.rec && r.rec.how === 'manual' ? '<span class="man">老師登記</span>' : '') + '</button>';
  }).join('') : '<div class="empty"><b>還沒有名單</b>按上面「👥 名單」貼上或匯入；也可以直接開始簽到。</div>') + '</div>';
  el.innerHTML = h;
  if(L.open) updQR();
  netPaint(); paintSessions(); paintProj();
}

/* ---------- 投影 ---------- */
var PROJ = false;
function paintProj(){
  var el = $('proj'); if(!el) return;
  el.hidden = !PROJ || !L.open;
  if(el.hidden) return;
  var s = curSess(), c = P.countSess(C, s, now()), t = P.curToken(C.secret, now(), CFG.rot, s.id);
  el.innerHTML = '<div class="pj"><div class="pjl"><img data-qr alt="簽到 QR code" src="' + (QR.img || '') + '"></div><div class="pjr"><div class="pjc">' + esc(C.name) + '</div><div class="pjs">' + esc(s.title || '') + '　' + esc(P.mdw(s.date)) + ' ' + esc(s.start) + '</div>' +
    '<div class="mode ' + L.mode + '">' + (L.mode === 'out' ? '請掃碼簽退' : '請掃碼簽到') + '</div><div class="pjh">用手機相機掃左邊的 QR code</div>' +
    '<div class="tok">現場碼 <b data-tok>' + t.tok + '</b></div><div class="bar"><i></i></div><div class="pjh" data-left></div>' +
    '<div class="pjn">已到 <b>' + c.arrived + '</b>／' + C.roster.length + '</div><div class="pjh">沒辦法掃描：打開 <span data-url></span>' + (C.cls.pw ? '，教室密碼 <b>' + esc(C.cls.pw) + '</b>' : '') + '</div></div></div><button type="button" class="pjx" data-act="projOff">✕ 回主持台（Esc）</button>';
  updQR();
}

/* ---------- 學生手動調整 ---------- */
function openWho(k){
  var s = curSess(), p = personOf(k), rec = s.recs[k] || {}, st = P.statusOf(s.recs[k], s, C.rule, now());
  openModal('<h2>' + esc(p.name) + ' <small>' + esc(p.no) + '</small></h2><p class="small">' + esc(s.title || '') + ' ' + esc(P.mdw(s.date)) + '・目前：' + esc(P.ST[st].n) + '・出席 ' + P.hoursOf(s.recs[k], s, C.rule, now()) + ' 小時</p>' +
    '<div class="row3"><label class="fld">簽到時間<input type="time" id="wIn" value="' + (rec.in ? P.hm(rec.in) : '') + '"></label><label class="fld">簽退時間<input type="time" id="wOut" value="' + (rec.out ? P.hm(rec.out) : '') + '"></label>' +
    '<label class="fld">狀態<select id="wSt"><option value="">依時間自動判斷</option>' + ['present', 'late', 'early', 'leave', 'official', 'absent'].map(function(x){ return '<option value="' + x + '"' + (rec.st === x ? ' selected' : '') + '>' + P.ST[x].n + (x === 'official' ? '（計時數）' : x === 'leave' ? '（不計時數）' : '') + '</option>'; }).join('') + '</select></label></div>' +
    '<label class="fld">備註<input id="wNote" maxlength="40" value="' + esc(rec.note || '') + '" placeholder="例如：病假、交通延誤"></label>' +
    '<div class="stack"><button type="button" class="btn green" data-act="whoNow">現在到了（簽到＝現在）</button><button type="button" class="btn" data-whosave="' + esc(k) + '">儲存</button><button type="button" class="btn red sm" data-whoclr="' + esc(k) + '">清除這堂紀錄</button><button type="button" class="btn alt" data-act="close">取消</button></div>');
}
function hmTs(date, v){ return v ? P.ts(date, v) : 0; }

/* ---------- 課程、名單、堂次 ---------- */
function courseSetHtml(){
  var r = C.rule;
  return '<h2>📝 課程設定</h2><label class="fld">課程名稱（會顯示在學生手機上）<input id="cName" maxlength="40" value="' + esc(C.name) + '"></label><label class="fld">辦訓單位（選填，印在簽到表上）<input id="cUnit" maxlength="40" value="' + esc(C.unit || '') + '"></label>' +
    '<fieldset class="fs"><legend>🏫 教室</legend><label class="fld">教室名稱（教室大廳裡看到的名字；空白＝用課程名稱）<input id="cRoomName" maxlength="20" value="' + esc(C.cls.name) + '" placeholder="' + esc(P.cut(C.name, 20)) + '"></label>' +
    '<label class="chk"><input type="checkbox" id="cPub"' + (C.cls.pub ? ' checked' : '') + '>公開在教室大廳（學生可以從「🎓 學生登入」直接點選；按開始簽到後才會出現）</label>' +
    '<label class="fld">教室密碼（選填，英文或數字 8 碼內）<input id="cPw" maxlength="8" autocomplete="off" style="text-transform:uppercase" value="' + esc(C.cls.pw) + '"></label><p class="small">QR code 會自動帶密碼，掃碼的學生不用打；從大廳或用代碼進來的學生才要輸入。簽到中改密碼，已在教室裡的手機要重新輸入。</p></fieldset>' +
    '<div class="row3"><label class="fld">遲到寬限（分鐘）<input id="rLate" type="number" min="0" max="120" value="' + r.late + '"></label><label class="fld">早退寬限（分鐘）<input id="rEarly" type="number" min="0" max="120" value="' + r.early + '"></label>' +
    '<label class="fld">出席率門檻<select id="rRatio">' + ['2/3', '80%', '100%', '50%', ''].map(function(x){ return '<option value="' + x + '"' + (String(r.ratio) === x ? ' selected' : '') + '>' + (x || '不判斷') + '</option>'; }).join('') + '</select></label></div>' +
    '<label class="fld">出席時數怎麼算<select id="rMode"><option value="actual"' + (r.mode === 'actual' ? ' selected' : '') + '>依實際在場時間（遲到、早退按比例扣，' + r.unit + ' 小時為單位捨去）</option><option value="full"' + (r.mode === 'full' ? ' selected' : '') + '>有到就算整堂</option></select></label>' +
    '<p class="small">門檻與時數算法只是預設值，請依各計畫最新規定（例如產業人才投資方案、企業內訓辦法）調整。</p>' +
    '<div class="stack"><button type="button" class="btn" data-act="courseSave">儲存</button><button type="button" class="btn alt" data-act="close">取消</button>' + (COURSES.length > 1 ? '<button type="button" class="btn red sm" data-act="courseDel">刪除這個課程</button>' : '') + '</div>';
}
function rosterHtml(){
  return '<h2>👥 名單（' + C.roster.length + ' 人）</h2><p class="small">從 Excel 複製「學號、姓名」兩欄貼上，或開啟 .xlsx／.csv。可以多一欄「身分證字號」（只用在匯出給訓練證書產生器，不會傳到學生手機）和「組別」。</p>' +
    '<textarea id="rText" rows="8" placeholder="學號&#9;姓名&#10;A001&#9;王小明&#10;A002&#9;陳美玲"></textarea>' +
    '<div class="stack"><button type="button" class="btn" data-act="rAdd">加入名單</button><button type="button" class="btn alt" data-act="rReplace">取代整份名單</button><label class="btn alt">📂 開啟 Excel／CSV<input type="file" id="rFile" accept=".xlsx,.csv,.txt,.tsv" hidden></label>' + (C.roster.length ? '<button type="button" class="btn red sm" data-act="rClear">清空名單</button>' : '') + '<button type="button" class="btn alt" data-act="close">關閉</button></div>' +
    (C.roster.length ? '<div class="tbl"><table><tr><th>學號</th><th>姓名</th><th>組別</th><th>身分證</th><th></th></tr>' + C.roster.map(function(p, i){ return '<tr><td>' + esc(p.no) + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.group) + '</td><td>' + esc(P.maskId(p.idno)) + '</td><td><button type="button" class="btn alt sm" data-rdel="' + i + '" aria-label="移除 ' + esc(p.name) + '">移除</button></td></tr>'; }).join('') + '</table></div>' : '');
}
function addRoster(list, replace){
  if(!list.length){ toast('讀不到名單，請確認有「姓名」或「學號」'); return; }
  if(replace) C.roster = [];
  var n = 0; list.forEach(function(p){ if(!C.roster.some(function(x){ return P.keyOf(x) === P.keyOf(p); })){ C.roster.push(p); n++; } });
  saveC(); render(); openModal(rosterHtml(), true); toast('加入 ' + n + ' 人');
}
function sessHtml(s){
  var isNew = !s; s = s || {date:P.ymd(now()), start:'09:00', end:'12:00', hours:'', title:'第 ' + (C.sessions.length + 1) + ' 堂'};
  return '<h2>' + (isNew ? '＋ 新增一堂' : '📝 修改這堂') + '</h2><label class="fld">名稱<input id="sTitle" maxlength="20" value="' + esc(s.title) + '"></label>' +
    '<div class="row3"><label class="fld">日期<input type="date" id="sDate" value="' + esc(s.date) + '"></label><label class="fld">開始<input type="time" id="sStart" value="' + esc(s.start) + '"></label><label class="fld">結束<input type="time" id="sEnd" value="' + esc(s.end) + '"></label></div>' +
    '<label class="fld">時數（空白＝依起訖時間；有午休請填實際上課時數）<input id="sHours" inputmode="decimal" value="' + esc(s.hours) + '"></label>' +
    '<div class="stack"><button type="button" class="btn" data-sesssave="' + (isNew ? '' : esc(s.id)) + '">儲存</button><button type="button" class="btn alt" data-act="close">取消</button>' + (isNew ? '' : '<button type="button" class="btn red sm" data-sessdel="' + esc(s.id) + '">刪除這堂</button>') + '</div>';
}

/* ---------- 總表、匯出、列印 ---------- */
function summaryHtml(){
  var S = P.summary(C, now()), sess = C.sessions;
  return '<h2>📊 出席總表 <small>' + esc(C.name) + '</small></h2><p class="small">應到 ' + S.planned + ' 小時' + (S.ratio ? '・門檻 ' + esc(C.rule.ratio) + '（' + Math.round(S.planned * S.ratio * 100) / 100 + ' 小時）' : '') + '。點格子可以到那一堂修改。</p>' +
    '<div class="tbl"><table class="sum"><tr><th>學號</th><th>姓名</th>' + sess.map(function(s, i){ return '<th title="' + esc(s.title) + '">' + (i + 1) + '<br><small>' + esc(P.mdw(s.date)) + '</small></th>'; }).join('') + '<th>時數</th><th>出席率</th><th>達標</th></tr>' +
    S.rows.map(function(r){ return '<tr><td>' + esc(r.p.no) + '</td><td>' + esc(r.p.name) + (r.extra ? ' <small>名單外</small>' : '') + '</td>' + r.cells.map(function(c, i){ return '<td class="st-' + c.st + '"><button type="button" data-goto="' + i + '" data-gk="' + esc(r.key) + '" title="' + esc(P.ST[c.st].n) + ' ' + c.h + ' 小時">' + esc(P.ST[c.st].s) + '</button></td>'; }).join('') +
      '<td>' + r.att + '</td><td>' + Math.round(r.rate * 1000) / 10 + '%</td><td class="' + (r.pass == null ? '' : r.pass ? 'pass' : 'fail') + '">' + (r.pass == null ? '' : r.pass ? '達標' : '未達') + '</td></tr>'; }).join('') + '</table></div>' +
    '<p class="small">✔ 出席　遲 遲到　退 早退　假 請假　公 公假　✖ 缺席　－ 未簽到</p><div class="stack"><button type="button" class="btn" data-act="export">⬇ 匯出・列印</button><button type="button" class="btn alt" data-act="close">關閉</button></div>';
}
function exportHtml(){
  return '<h2>⬇ 匯出・列印</h2><div class="stack col">' +
    '<button type="button" class="btn" data-act="xSumX">📊 出席總表（Excel）</button><button type="button" class="btn alt" data-act="xSumC">📊 出席總表（CSV）</button>' +
    '<button type="button" class="btn alt" data-act="xSess">🕘 這一堂的簽到紀錄（CSV）</button>' +
    '<button type="button" class="btn green" data-act="xCert">🎓 給訓練證書產生器的名單（Excel：姓名、身分證字號、出席時數）</button>' +
    '<button type="button" class="btn alt" data-act="pSess">🖨 列印這一堂的簽到表（含簽名欄）</button><button type="button" class="btn alt" data-act="pSum">🖨 列印出席總表</button>' +
    '<button type="button" class="btn alt" data-act="backup">💾 備份這個課程（.json）</button><label class="btn alt">📂 還原備份<input type="file" id="bFile" accept=".json,application/json" hidden></label></div>' +
    '<p class="small">訓練證書產生器在「學員名單」按「開啟 Excel」選這個檔，會自動認出姓名、身分證字號、出席時數三欄。</p><div class="stack"><button type="button" class="btn alt" data-act="close">關閉</button></div>';
}
function preparePrint(kind){
  var pa = $('printArea'), s = curSess(), h = '';
  if(kind === 'sess'){
    var rows = P.sessRows(C, s, now());
    h = '<div class="pp"><h1>' + esc(C.unit ? C.unit + '　' : '') + esc(C.name) + '　簽到表</h1><p>' + esc(s.title || '') + '　' + esc(s.date) + ' ' + esc(s.start) + '–' + esc(s.end) + '（' + P.sessHours(s) + ' 小時）　列印時間 ' + esc(P.ymd(now())) + ' ' + P.hm(now()) + '</p>' +
      '<table><tr><th>#</th><th>學號</th><th>姓名</th><th>狀態</th><th>簽到</th><th>簽退</th><th>時數</th><th>簽名</th><th>備註</th></tr>' + rows.slice(1).map(function(r, i){ return '<tr><td>' + (i + 1) + '</td><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td><td>' + esc(r[3]) + '</td><td>' + esc(r[4]) + '</td><td>' + esc(r[7]) + '</td><td class="sig"></td><td>' + esc(r[9]) + '</td></tr>'; }).join('') + '</table><p class="pn">已到 ' + P.countSess(C, s, now()).arrived + '／' + C.roster.length + ' 人。掃碼紀錄由出席簽到 QR 產生，請講師或承辦人核對後簽章：＿＿＿＿＿＿＿＿</p></div>';
  } else {
    var X = P.exportRows(C, now(), false);
    h = '<div class="pp land"><h1>' + esc(C.unit ? C.unit + '　' : '') + esc(C.name) + '　出席總表</h1><p>列印時間 ' + esc(P.ymd(now())) + ' ' + P.hm(now()) + '　門檻 ' + esc(C.rule.ratio || '不判斷') + '</p><table><tr>' + X[0].map(function(c){ return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>' + X.slice(1).map(function(r){ return '<tr>' + r.map(function(c){ return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>';
  }
  pa.innerHTML = h; pa.className = kind === 'sess' ? '' : 'land';
}
function doPrint(kind){ closeModal(); preparePrint(kind); setTimeout(function(){ window.print(); }, 80); }
window.addEventListener('afterprint', function(){ $('printArea').innerHTML = ''; });

/* ---------- 警語與設定 ---------- */
var WARN_HTML = '<h2>⚠ 使用警語</h2><ul>' +
  '<li>掃碼簽到可以減少代簽（現場碼每隔一段時間會換、同一支手機不能幫第二個人簽），但<b>防不了所有作弊</b>，例如同學把手機借給別人。重要課程請搭配現場點名或紙本簽名。</li>' +
  '<li>遲到、早退的寬限分鐘、出席率門檻與時數算法都只是預設值，<b>請依各計畫或公司最新規定設定</b>；匯出的時數請核對後再用於結訓或請款。</li>' +
  '<li>名單與簽到紀錄（含身分證字號）<b>只存在這台電腦的瀏覽器</b>，不會上傳；學生手機只會送出學號和姓名。換電腦或清除瀏覽器資料前請先「備份」。</li>' +
  '<li>手機連線借用公開的轉播服務，學生送出的學號姓名會經過轉播伺服器（不保存）；轉播站可能把不雅字詞遮成 *，以學號比對為主。</li>' +
  '<li>簽到時間以轉播伺服器收到的時間為準。網路不穩時可以在老師端手動登記。範例中的人名全部虛構。</li></ul>';
function showWarn(){ openModal(WARN_HTML + '<div class="stack"><button type="button" class="btn" data-act="close">我知道了</button></div>'); }
function sec(id, title, val, body){ return '<details class="set-sec" data-sec="' + id + '"><summary><span class="sst">' + title + '</span><span class="ssv">' + esc(val) + '</span></summary><div class="set-body">' + body + '</div></details>'; }
function seg(key, opts){ return '<div class="seg">' + opts.map(function(o){ return '<button type="button" data-cfg="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (String(CFG[key]) === String(o[0])) + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
function openSettings(openId){
  var h = '<div class="stack" style="align-items:center"><h2 style="flex:1 1 auto">⚙ 常用設定</h2><button type="button" class="btn alt sm" data-act="foldall">全部展開／收合</button></div>' +
    sec('qr', '現場碼多久換一次', CFG.rot > 0 ? CFG.rot + ' 秒' : '不換', seg('rot', [[10, '10 秒'], [20, '20 秒'], [30, '30 秒'], [60, '60 秒'], [0, '不換']]) + '<p class="small">越短越難拍照傳給沒來的人。選「不換」可以把 QR 印出來貼在門口（老師這頁仍要開著、按開始簽到）。</p>') +
    sec('win', '掃完多久內要送出', Math.round(CFG.win / 60) + ' 分鐘', seg('win', [[60, '1 分鐘'], [120, '2 分鐘'], [300, '5 分鐘']]) + '<p class="small">學生掃了 QR 之後要在這段時間內按送出，不然會請他重新掃。</p>') +
    sec('view', '顯示與音效', (CFG.fs === 'xl' ? '大字' : '標準字') + (lsGet('mute') === '1' ? '・靜音' : ''), seg('fs', [['m', '標準字'], ['xl', '大字']]) + '<label class="chk"><input type="checkbox" id="muteChk"' + (lsGet('mute') === '1' ? ' checked' : '') + '>有人簽到時不要發出聲音</label>') +
    sec('adm', '🔐 管理密碼', ADM ? (ADM.list ? '已設定・名單保護' : '已設定') : '沒有設定', admSection()) +
    sec('wipe', '🧹 清除全部資料', COURSES.length + ' 個課程', '<p class="small">刪掉這台電腦上所有課程、名單、簽到紀錄。請先匯出備份。</p><div class="stack"><button type="button" class="btn red" data-act="wipe">清除全部資料</button></div>') +
    sec('about', '關於本工具', '', '<p>👤 創作者 Mark Tsai（蔡豐全）<br><a href="mailto:tsaimark@gmail.com">tsaimark@gmail.com</a></p><div class="stack"><a class="btn alt" href="manual.html">📖 操作手冊</a><a class="btn alt" href="manual.html#creator">👤 創作者資訊</a><button type="button" class="btn alt" data-act="warn">⚠ 使用警語</button>' +
      (standalone ? '' : '<button type="button" class="btn alt" data-act="install">📲 加入主畫面</button>') + '</div><p class="small" style="margin-top:.5rem">訪客數 <img src="' + BADGE + '" alt="訪客次數" height="20" loading="lazy" style="vertical-align:middle"></p>') +
    '<div class="stack"><button type="button" class="btn" data-act="close">關閉</button></div>';
  openModal(h);
  var open = lsJson('fold', ['qr']);
  if(typeof openId === 'string' && open.indexOf(openId) < 0) open.push(openId);
  document.querySelectorAll('.set-sec').forEach(function(d){ d.open = open.indexOf(d.dataset.sec) >= 0; d.addEventListener('toggle', saveFold); });
}
function saveFold(){ var o = []; document.querySelectorAll('.set-sec').forEach(function(d){ if(d.open) o.push(d.dataset.sec); }); lsSet('fold', JSON.stringify(o)); }
function applyView(){ document.documentElement.dataset.fs = CFG.fs === 'xl' ? 'xl' : 'm'; }
function install(){
  if(window._dp){ window._dp.prompt(); window._dp = null; return; }
  openModal('<h2>📲 加入主畫面</h2><ul><li><b>電腦（Chrome／Edge）</b>：網址列右邊的安裝圖示。</li><li><b>iPhone（Safari）</b>：「分享」→「加入主畫面」。</li><li><b>Android（Chrome）</b>：右上角「⋮」→「安裝應用程式」。</li></ul><div class="stack"><button type="button" class="btn" data-act="close">知道了</button></div>');
}

/* ---------- 動作 ---------- */
function wipeAll(keepAdm){
  if(L.open) stopCheck();
  COURSES.forEach(function(c){ lsDel('course.' + c.id); });
  try{ Object.keys(localStorage).forEach(function(k){ if(k.indexOf(PFX + 'tkey.') === 0) localStorage.removeItem(k); }); }catch(e){}
  ['courses', 'cur', 'fold'].forEach(lsDel); ssSet('cur', '');
  if(!keepAdm){ lsDel('adm'); ADM = null; UNLOCK = 0; }
  COURSES = []; boot(); closeModal(); toast(keepAdm ? '已清除，放回範例' : '已清除全部資料（含管理密碼）');
}
var ACT = {
  close:closeModal, warn:showWarn, settings:openSettings, install:install,
  foldall:function(){ var ds = document.querySelectorAll('.set-sec'), any = Array.prototype.some.call(ds, function(d){ return !d.open; }); ds.forEach(function(d){ d.open = any; }); saveFold(); },
  start:startCheck, stop:stopCheck,
  proj:function(){ PROJ = true; paintProj(); }, projOff:function(){ PROJ = false; paintProj(); },
  copyJoin:function(){ copyText(QR.url, '已複製簽到連結（現場碼會過期，建議用 QR）'); },
  newCourse:function(){ if(L.open){ toast('請先結束簽到'); return; } C = newCourse({name:'新課程 ' + (COURSES.length + 1)}); saveC(); render(); openModal(courseSetHtml()); },
  courseSet:function(){ openModal(courseSetHtml()); },
  courseSave:function(){ C.name = P.cut($('cName').value, 40) || '未命名課程'; C.unit = P.cut($('cUnit').value, 40); C.rule.late = Math.max(0, +$('rLate').value || 0); C.rule.early = Math.max(0, +$('rEarly').value || 0); C.rule.ratio = $('rRatio').value; C.rule.mode = $('rMode').value;
    var pw = cleanPw($('cPw').value), pwChanged = pw !== C.cls.pw; C.cls.name = P.cut($('cRoomName').value, 20); C.cls.pub = $('cPub').checked; C.cls.pw = pw;
    saveC(); closeModal(); render(); syncSoon();
    if(L.open){ if(pwChanged){ var code = C.room; netStop(false); NET.state = P.encState(true, L.mode, sessIdx()); netStart(code, pw); QR.tok = ''; updQR(); } else sendRoomInfo(); }
    toast('已儲存課程設定'); },
  courseDel:function(){ if(courseLive(C.id)){ blocked('這個課程正在簽到，不能刪除。'); return; } sureOr('刪除課程「' + C.name + '」（名單、堂次、簽到紀錄都會刪掉）', ACT.courseDelOk); },
  courseDelOk:function(){ if(L.open) stopCheck(); lsDel('course.' + C.id); COURSES = COURSES.filter(function(x){ return x.id !== C.id; }); lsSet('courses', JSON.stringify(COURSES)); C = loadC(COURSES[0].id); saveC(); closeModal(); render(); },
  roster:function(){ guardView('看名單', function(){ openModal(rosterHtml(), true); }); },
  rAdd:function(){ if(roOther()){ toast('這個課程正在另一個分頁簽到，請到那邊修改'); return; } addRoster(P.parseRoster($('rText').value), false); },
  rReplace:function(){ if(courseLive(C.id)){ blocked('簽到中不能取代整份名單。'); return; } var list = P.parseRoster($('rText').value); sureOr('取代整份名單', function(){ addRoster(list, true); }); },
  rClear:function(){ if(courseLive(C.id)){ blocked('簽到中不能清空名單。'); return; } sureOr('清空名單', function(){ C.roster = []; saveC(); render(); openModal(rosterHtml(), true); }); },
  addSess:function(){ openModal(sessHtml(null)); }, editSess:function(){ openModal(sessHtml(curSess())); },
  summary:function(){ guardView('看出席總表', function(){ openModal(summaryHtml(), true); }); }, export:function(){ guardView('匯出・列印', function(){ openModal(exportHtml()); }); },
  xSumX:function(){ saveBlob(safeName(C.name) + '_出席總表.xlsx', IO.xlsxBlob(P.exportRows(C, now(), false), '出席總表', [10, 10, 8].concat(C.sessions.map(function(){ return 16; }), [9, 9, 8, 6]))); },
  xSumC:function(){ saveBlob(safeName(C.name) + '_出席總表.csv', new Blob(['﻿' + IO.csvText(P.exportRows(C, now(), false))], {type:'text/csv;charset=utf-8'})); },
  xSess:function(){ var s = curSess(); saveBlob(safeName(C.name) + '_' + s.date + '_簽到紀錄.csv', new Blob(['﻿' + IO.csvText(P.sessRows(C, s, now()))], {type:'text/csv;charset=utf-8'})); },
  xCert:function(){ saveBlob(safeName(C.name) + '_給訓練證書產生器.xlsx', IO.xlsxBlob(P.certRows(C, now()), '名單', [10, 14, 10, 10])); toast('已下載。身分證字號只有名單裡有填才會帶出'); },
  pSess:function(){ doPrint('sess'); }, pSum:function(){ doPrint('sum'); },
  backup:function(){ guardView('備份', function(){ saveBlob(safeName(C.name) + '_出席備份_' + P.ymd(now()) + '.json', new Blob([JSON.stringify({app:'attendance-qr', v:1, course:C})], {type:'application/json'})); }); },
  wipe:function(){ if(liveAnywhere()){ blocked('有分頁正在簽到，不能清除全部資料。'); return; } sureOr('清除全部資料（所有課程、名單、簽到紀錄，管理密碼保留）', function(){ wipeAll(true); }); },
  wipeOk:function(){ wipeAll(true); },
  sureOk:function(){ var f = SURE_CB; SURE_CB = null; closeModal(); if(f) f(); },
  pinOk:pinOk,
  admLock:function(){ UNLOCK = 0; paintTop(); toast('已上鎖'); },
  admSet:function(){ var a = $('admN1').value, b = $('admN2').value, m = $('admMsg'); if(!/^\d{4,8}$/.test(a)){ m.textContent = '請輸入 4～8 位數字'; return; } if(a !== b){ m.textContent = '兩次輸入的不一樣'; return; } var salt = randId(); hashPin(a, salt).then(function(h){ ADM = {salt:salt, hash:h, list:$('admList').checked, at:now()}; lsSet('adm', JSON.stringify(ADM)); UNLOCK = now() + 10 * 60000; openSettings('adm'); paintTop(); toast('管理密碼設定好了'); }); },
  admChange:function(){ askPin('改管理密碼', function(){ openModal('<h2>🔐 新的管理密碼</h2><div class="row3"><label class="fld">新密碼（4～8 位數字）<input id="admN1" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label><label class="fld">再輸入一次<input id="admN2" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label></div><label class="chk"><input type="checkbox" id="admList"' + (ADM.list ? ' checked' : '') + '>名單保護</label><p class="small" id="admMsg"></p><div class="stack"><button type="button" class="btn" data-act="admSet">儲存新密碼</button><button type="button" class="btn alt" data-act="close">取消（保留舊密碼）</button></div>'); }); },
  admListT:function(){ askPin((ADM.list ? '關掉' : '打開') + '名單保護', function(){ ADM.list = !ADM.list; lsSet('adm', JSON.stringify(ADM)); openSettings('adm'); paintTop(); }); },
  admOff:function(){ askPin('取消管理密碼', function(){ ADM = null; lsDel('adm'); UNLOCK = 0; openSettings('adm'); paintTop(); toast('已取消管理密碼'); }); },
  admForget:function(){ if(liveAnywhere()){ blocked('有分頁正在簽到，請先結束簽到。'); return; } openModal('<h2>忘記管理密碼</h2><p>只能<b>清除這台電腦上全部的資料</b>（所有課程、名單、簽到紀錄、管理密碼）重新開始。請先確認有沒有匯出備份。</p><label class="fld">確定的話請輸入「清除全部」<input id="forgetIn" autocomplete="off"></label><div class="stack"><button type="button" class="btn red" data-act="admForgetOk">清除全部並重設</button><button type="button" class="btn alt" data-act="close">取消</button></div>'); },
  admForgetOk:function(){ if(($('forgetIn').value || '').trim() !== '清除全部'){ toast('請輸入「清除全部」四個字'); return; } wipeAll(false); },
  lobby:openLobby, lobbyRefresh:function(){ fetchLobby(); },
  lobbyPwOk:function(){ var pw = cleanPw(($('lobbyPwIn') || {}).value); if(!pw){ toast('請輸入密碼'); return; } closeModal(); goRoom(LPICK, pw); },
  joinGo:function(){ var code = P.cleanRoom(($('joinCode') || {}).value), pw = cleanPw(($('joinPw') || {}).value); if(!code){ toast('教室代碼是 6 碼英文和數字'); return; } goRoom(code, pw); },
  pwGo:function(){ var pw = cleanPw(($('stuPw') || {}).value); if(!pw){ toast('請輸入教室密碼'); return; } try{ localStorage.setItem(PFX + 'spw.' + JOIN, pw); }catch(e){} S.needPw = false; S.pwBad = false; renderStu(); netStart(JOIN, pw); },
  whoNow:function(){ var v = P.hm(now()); $('wIn').value = v; },
};
document.addEventListener('click', function(e){
  var t = e.target.closest('[data-act],[data-lob],[data-sess],[data-mode],[data-who],[data-whosave],[data-whoclr],[data-sesssave],[data-sessdel],[data-cfg],[data-pok],[data-pno],[data-dok],[data-dno],[data-rdel],[data-goto],[data-send],[data-again]');
  if(!t) return;
  var d = t.dataset;
  if(d.act && ACT[d.act]){ if(t.tagName === 'A') e.preventDefault(); ACT[d.act](); return; }
  if(d.lob){ lobbyPick(d.lob, d.lpw === '1', d.lname); return; }
  if(JOINPAGE){ if(d.send != null) S.submit(); else if(d.again != null) S.again(); return; }
  var s = curSess();
  if(roOther() && (d.who || d.whosave || d.whoclr || d.sesssave != null || d.sessdel || d.pok != null || d.pno != null || d.dok != null || d.dno != null || d.rdel != null || d.mode)){ closeModal(); toast('這個課程正在另一個分頁簽到，請到那個分頁修改'); return; }
  if(d.sess){ if(L.open && d.sess !== C.cur){ toast('簽到中不能換堂次，請先結束簽到'); return; } C.cur = d.sess; saveC(); render(); return; }
  if(d.mode){ L.mode = d.mode; pushState(); paintMain(); return; }
  if(d.who){ openWho(d.who); return; }
  if(d.whosave){
    var k = d.whosave, rec = s.recs[k] || {};
    rec.in = hmTs(s.date, $('wIn').value) || 0; rec.out = hmTs(s.date, $('wOut').value) || 0; rec.st = $('wSt').value || ''; rec.note = P.cut($('wNote').value, 40); rec.how = rec.how === 'qr' && rec.in ? 'qr' : 'manual';
    if(!rec.in) delete rec.in; if(!rec.out) delete rec.out; if(!rec.st) delete rec.st;
    if(rec.in || rec.out || rec.st || rec.note) s.recs[k] = rec; else delete s.recs[k];
    saveC(); closeModal(); paintMain(); return;
  }
  if(d.whoclr){ delete s.recs[d.whoclr]; Object.keys(s.devs).forEach(function(x){ if(s.devs[x] === d.whoclr) delete s.devs[x]; }); saveC(); closeModal(); paintMain(); return; }
  if(d.sesssave != null){
    var o = {title:P.cut($('sTitle').value, 20), date:$('sDate').value, start:$('sStart').value, end:$('sEnd').value, hours:$('sHours').value.trim()};
    if(!o.date || !o.start || !o.end || P.ts(o.date, o.end) <= P.ts(o.date, o.start)){ toast('請填日期，結束時間要晚於開始時間'); return; }
    if(d.sesssave){ Object.assign(C.sessions.find(function(x){ return x.id === d.sesssave; }), o); }
    else { var ns = Object.assign({id:'s' + randId().slice(0, 8), recs:{}, devs:{}, pending:[], dupes:[], seen:[]}, o); C.sessions.push(ns); C.sessions.sort(function(a, b){ return (a.date + a.start).localeCompare(b.date + b.start); }); if(!L.open) C.cur = ns.id; }
    saveC(); closeModal(); render(); return;
  }
  if(d.sessdel){
    var tgt = C.sessions.find(function(x){ return x.id === d.sessdel; });
    if(L.open && C.cur === tgt.id){ blocked('這一堂正在簽到，不能刪除。'); return; }
    var del = function(){ C.sessions = C.sessions.filter(function(x){ return x !== tgt; }); C.cur = C.sessions[0] ? C.sessions[0].id : ''; saveC(); closeModal(); render(); };
    if(Object.keys(tgt.recs).length) sureOr('刪除這一堂（有 ' + Object.keys(tgt.recs).length + ' 筆簽到紀錄）', del); else del();
    return;
  }
  if(d.cfg){ var v = d.v; CFG[d.cfg] = /^\d+$/.test(v) ? +v : v; saveCfg(); applyView(); QR.tok = ''; if(L.open) updQR(); openSettings(); return; }
  if(d.pok != null){ var x = s.pending.splice(+d.pok, 1)[0], np = {no:x.no, name:x.name, idno:'', group:'名單外'}; C.roster.push(np); var key = P.keyOf(np); s.recs[key] = x.mode === 'out' ? {out:x.at, dev:x.dev, how:'qr'} : {in:x.at, dev:x.dev, how:'qr'}; s.devs[x.dev] = key; T.ack(x.dev, x.mode === 'out' ? 7 : 1); saveC(); render(); return; }
  if(d.pno != null){ s.pending.splice(+d.pno, 1); saveC(); paintMain(); return; }
  if(d.dok != null){ var y = s.dupes.splice(+d.dok, 1)[0], r = s.recs[y.key] || {}; if(!r.in) r.in = y.at; r.how = 'manual'; r.note = (r.note ? r.note + '；' : '') + '用別人的手機簽到，老師確認'; s.recs[y.key] = r; saveC(); paintMain(); return; }
  if(d.dno != null){ s.dupes.splice(+d.dno, 1); saveC(); paintMain(); return; }
  if(d.rdel != null){ C.roster.splice(+d.rdel, 1); saveC(); render(); openModal(rosterHtml(), true); return; }
  if(d.goto != null){ C.cur = C.sessions[+d.goto].id; saveC(); closeModal(); render(); openWho(d.gk); return; }
});
document.addEventListener('change', function(e){
  var t = e.target;
  if(t.id === 'courseSel'){ if(L.open){ toast('簽到中不能換課程，請先結束簽到；要同時簽另一班，請另開一個分頁'); t.value = C.id; return; } C = loadC(t.value); ssSet('cur', C.id); lsSet('cur', C.id); render(); return; }
  if(t.id === 'muteChk'){ lsSet('mute', t.checked ? '1' : '0'); return; }
  if(t.id === 'rFile' && t.files[0]){ IO.readFile(t.files[0]).then(function(r){ addRoster(P.parseRoster(r.rows), false); }).catch(function(err){ toast(err.message); }); return; }
  if(t.id === 'bFile' && t.files[0]){
    if(liveAnywhere()){ t.value = ''; blocked('有分頁正在簽到，不能還原備份。'); return; }
    var fr = new FileReader();
    fr.onload = function(){ var o; try{ o = JSON.parse(fr.result); }catch(err){ o = null; } t.value = ''; if(!o || o.app !== 'attendance-qr' || !o.course){ toast('這不是出席簽到 QR 的備份檔'); return; } sureOr('還原「' + P.cut(o.course.name, 20) + '」', function(){ try{ var c = o.course; if(COURSES.some(function(x){ return x.id === c.id; })) c.id = 'c' + randId().slice(0, 8); lsSet('course.' + c.id, JSON.stringify(c)); C = loadC(c.id); C.room = P.newRoom(); saveC(); closeModal(); render(); toast('已還原「' + C.name + '」'); }catch(err){ toast('這不是出席簽到 QR 的備份檔'); } }); };
    fr.readAsText(t.files[0]);
  }
});
$('modal').addEventListener('click', function(e){ if(e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', function(e){ if(e.key !== 'Escape') return; if(PROJ){ PROJ = false; paintProj(); } else if($('modal').classList.contains('show')) closeModal(); });

/* ============================ 學生手機 ============================ */
var S = {
  k:(QS.get('k') || '').replace(/\D/g, '').slice(0, 4), scannedAt:now(), me:lsJson('me', {no:'', name:''}), teacher:null, course:'', sess:'', phase:'form', res:null, closed:0, sentAt:0, retried:false, tmr:0,
  onPeers:function(){ var st = null; Object.keys(NET.peers).forEach(function(id){ var x = P.decState(NET.peers[id]); if(x) st = x; }); S.teacher = st; renderStu(); },
  onChat:function(m){
    var r = P.decRoom(m.text); if(r){ S.course = r.course; S.sess = r.sess; renderStu(); return; }
    var mine = P.decAcks(m.text).filter(function(a){ return a.id === String(NET.myId).slice(0, 6); });
    if(!mine.length || S.phase !== 'wait') return;
    var c = mine[mine.length - 1].c; clearTimeout(S.tmr);
    S.res = {c:c, at:m.at || now()}; S.phase = 'done';
    if(c === 4) S.k = '';
    renderStu();
  },
  submit:function(){
    var no = ($('meNo') || {}).value || '', name = ($('meName') || {}).value || '', k = ($('meK') || {}).value || S.k;
    no = P.cut(no, 20).replace(/\s/g, ''); name = P.cut(name, 12);
    if(!name){ S.err = '請填姓名'; renderStu(); return; }
    if(!/^\d{4}$/.test(String(k).replace(/\D/g, ''))){ S.err = '請填投影幕上的 4 位數現場碼'; renderStu(); return; }
    k = String(k).replace(/\D/g, '');
    S.k = k; S.me = {no:no, name:name}; lsSet('me', JSON.stringify(S.me)); S.err = ''; S.draft = null;
    var mode = S.teacher && S.teacher.mode === 'out' ? 'out' : 'in';
    queueChats([P.encCheck(mode, k, no, name)], 'check', true);
    S.phase = 'wait'; S.sentAt = now(); S.retried = false; renderStu();
    clearTimeout(S.tmr);
    S.tmr = setTimeout(function(){ if(S.phase === 'wait'){ S.retried = true; queueChats([P.encCheck(mode, k, no, name)], 'check', true); S.tmr = setTimeout(function(){ if(S.phase === 'wait'){ S.phase = 'slow'; renderStu(); } }, 15000); } }, 12000);
  },
  again:function(){ S.phase = 'form'; S.res = null; renderStu(); },
};
function renderEntry(){
  var h = '<header class="stop"><div class="clock" aria-hidden="true"><span>' + P.hm(now()) + '</span></div><h1>出席簽到・學生登入</h1></header><div class="stu"><div class="scard">' +
    '<div class="sc">🏫 選你的教室</div><div data-lobbylist>' + lobbyListHtml() + '</div><button type="button" class="btn alt sm" data-act="lobbyRefresh">🔄 重新整理</button>' +
    '<hr class="hr"><div class="sc" style="font-size:1.05rem">⌨ 或輸入老師給的教室代碼</div><label class="fld">教室代碼（6 碼）<input id="joinCode" maxlength="6" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase"></label>' +
    '<label class="fld">教室密碼（沒有就空白）<input id="joinPw" maxlength="8" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase"></label><button type="button" class="btn green big" data-act="joinGo">進入教室</button>' +
    '<p class="small">最快的方法是用手機相機掃老師投影的 QR code，不用選教室也不用打密碼。</p></div></div><footer class="foot"><a href="manual.html">📖 說明</a><a href="#" data-act="warn">⚠ 使用警語</a></footer>';
  $('app').innerHTML = h;
}
function renderStu(){
  // 轉播站隨時可能推新狀態來，重畫前先把正在打的字收起來，不然會被清掉
  ['meNo', 'meName', 'meK'].forEach(function(id){ var el = $(id); if(el){ S.draft = S.draft || {}; S.draft[id] = el.value; } });
  var D = S.draft || {};
  var h ='<header class="stop"><div class="clock" aria-hidden="true"><span>' + P.hm(now()) + '</span></div><h1>出席簽到</h1><span class="chip" id="netChip">' + netChipHtml() + '</span></header><div class="stu">';
  var mode = S.teacher && S.teacher.mode === 'out' ? 'out' : 'in', word = mode === 'out' ? '簽退' : '簽到';
  h += '<div class="scard"><div class="sc">' + esc(S.course || '課程') + '</div>' + (S.sess ? '<div class="small">' + esc(S.sess) + '</div>' : '') + (S.closed ? '' : '<div class="mode ' + mode + '">' + (S.teacher && !S.teacher.open ? '老師暫停中' : word) + '</div>');
  if(S.needPw){ h += '<div class="res wait"><b>🔒 這間教室有密碼</b>' + (S.pwBad ? '<p>密碼不對，或老師剛改了密碼。</p>' : '<p>請輸入老師公布的教室密碼（掃投影幕上的 QR 就不用打）。</p>') + '</div><label class="fld">教室密碼<input id="stuPw" maxlength="8" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase"></label><button type="button" class="btn green big" data-act="pwGo">進入教室</button>'; }
  else if(S.closed){ h += '<div class="res bad"><b>⏹ 簽到已經結束或還沒開始</b>請等老師開始簽到後，重新掃投影幕上的 QR code。</div><a class="btn alt" href="?join">🏫 回教室大廳</a>'; }
  else if(S.phase === 'done' && S.res){
    var ok = P.ACK_OK[S.res.c], lateish = S.res.c === 2 || S.res.c === 8;
    h += '<div class="res ' + (ok ? (lateish ? 'warn' : 'ok') : 'bad') + '"><div class="big">' + (ok ? '✔' : '✖') + '</div><b>' + esc(P.ACK[S.res.c] || '') + '</b><div class="when">' + esc(S.me.name) + '　' + P.hm(S.res.at) + '</div></div>';
    if(!ok) h += '<button type="button" class="btn big" data-again>' + (S.res.c === 4 ? '重新輸入現場碼' : '回上一步') + '</button>';
    else h += '<p class="small">可以關掉這個畫面了。' + (mode === 'in' ? '下課前老師可能會再請大家掃碼簽退。' : '') + '</p>';
  } else if(S.phase === 'wait' || S.phase === 'slow'){
    h += '<div class="res wait"><div class="big spin">⏳</div><b>送出了，等老師那邊確認…</b>' + (S.phase === 'slow' ? '<p>老師那邊還沒有回應，可能網路比較慢。請舉手告訴老師你的名字。</p><button type="button" class="btn" data-again>再送一次</button>' : '') + '</div>';
  } else {
    h += '<label class="fld">學號／工號<input id="meNo" maxlength="20" autocomplete="off" inputmode="text" value="' + esc(D.meNo != null ? D.meNo : S.me.no) + '"></label><label class="fld">姓名<input id="meName" maxlength="12" autocomplete="name" value="' + esc(D.meName != null ? D.meName : S.me.name) + '"></label>' +
      (S.k ? '' : '<label class="fld">現場碼（投影幕上的 4 位數）<input id="meK" inputmode="numeric" maxlength="4" autocomplete="off" value="' + esc(D.meK || '') + '"></label>') +
      (S.err ? '<div class="res bad small"><b>' + esc(S.err) + '</b></div>' : '') +
      '<button type="button" class="btn green big" data-send' + (NET.status !== 'on' ? ' disabled' : '') + '>' + (NET.status === 'on' ? '✔ ' + word : '連線中…') + '</button><p class="small">這支手機會記住你的學號和姓名，下次直接按就好。一支手機只能幫一個人' + word + '。</p>';
  }
  h += '</div></div><footer class="foot"><a href="manual.html">📖 說明</a><a href="#" data-act="warn">⚠ 使用警語</a></footer>';
  var a = document.activeElement, id = a && a.id, sel = null; try{ sel = a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null; }catch(e){}
  $('app').innerHTML = h;
  if(id && $(id)){ var b = $(id); b.focus(); if(sel) try{ b.setSelectionRange(sel[0], sel[1]); }catch(e){} }
}

/* ---------- 跑馬燈（工作區共用公告，不可關） ---------- */
function initMarquee(){
  var URL_ = "https://script.google.com/macros/s/AKfycbwKX0DNNbY8y4nf90BFTHtxgfqJcHHcZasRrgycl4QAe52_hkjMWSkYk4xOsqU-JPCROw/exec";
  var REFRESH = 20 * 60 * 1000, bar = $('marqueeBar'), track = $('marqueeTrack'), lastKey = null;
  function appendText(c, text){ var re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, li = 0, m; while((m = re.exec(text))){ if(m.index > li) c.appendChild(document.createTextNode(text.slice(li, m.index))); var a = document.createElement('a'); a.href = m[2]; a.textContent = m[1]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.color = 'inherit'; a.style.textDecoration = 'underline'; c.appendChild(a); li = re.lastIndex; } if(li < text.length) c.appendChild(document.createTextNode(text.slice(li))); }
  function renderM(items){
    if(!items || !items.length) return;
    var k = JSON.stringify(items); if(k === lastKey) return; lastKey = k; track.innerHTML = '';
    var fr = document.createDocumentFragment();
    function pass(){ items.forEach(function(it, i){ if(i > 0) fr.appendChild(document.createTextNode('　★　')); appendText(fr, String(it)); }); }
    pass(); fr.appendChild(document.createTextNode('　★　')); pass(); track.appendChild(fr);
    bar.classList.add('show'); document.body.classList.add('has-marquee');
    track.style.animationDuration = Math.max(track.scrollWidth / 2 / 60, 12) + 's';
  }
  function fetchM(){ fetch(URL_, {method:'POST', body:JSON.stringify({serial:''})}).then(function(r){ return r.json(); }).then(function(d){ if(d && Array.isArray(d.marquee) && d.marquee.length){ lsSet('marquee', JSON.stringify(d.marquee)); renderM(d.marquee); } }).catch(function(){}); }
  renderM(lsJson('marquee', [])); fetchM(); setInterval(fetchM, REFRESH);
}

window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); window._dp = e; });
if('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(function(){});
setInterval(function(){ var c = $('clockNow'); if(c) c.textContent = P.hm(now()); }, 10000);

function boot(){
  COURSES = lsJson('courses', []);
  var id = ssGet('cur') || lsGet('cur');
  C = (id && loadC(id)) || (COURSES[0] && loadC(COURSES[0].id));
  if(!C){ C = newCourse(P.example()); saveC(); }
  render();
}
applyView();
if(JOINPAGE){
  document.body.classList.add('student');
  if(JOIN){ var spw = cleanPw(QS.get('pw') || lsGet('spw.' + JOIN) || ''); if(QS.get('pw')) lsSet('spw.' + JOIN, spw); renderStu(); netStart(JOIN, spw); }
  else { renderEntry(); startLobby(); }
} else {
  boot(); startLobby(); askTabs().then(function(){ if(!$('modal').classList.contains('show')) render(); });
  if(!lsGet('warnSeen')){ showWarn(); lsSet('warnSeen', '1'); }
}
initMarquee();
window._atq = {get C(){ return C; }, get L(){ return L; }, get S(){ return S; }, get NET(){ return NET; }, get QR(){ return QR; }, get CFG(){ return CFG; }, T:T, ACT:ACT, preparePrint:preparePrint, joinUrl:joinUrl, render:render};
})();

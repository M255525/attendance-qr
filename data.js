/* 出席簽到 QR：純函式引擎（不碰 DOM，node 也能 require 測試）
   現場碼（每 N 秒換）、名單解析、手機與老師之間的訊息格式、準時／遲到／早退判定、出席時數、總表與匯出列。 */
(function(root){
'use strict';

const cut = (s, n) => Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ')).slice(0, n).join('').trim();
const FW = (s) => String(s == null ? '' : s).replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');

/* ---------- 亂數與代碼 ---------- */
function cryptoInt(n){
  const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
  if(c){ const a = new Uint32Array(1); c.getRandomValues(a); return a[0] % n; }
  return Math.floor(Math.random() * n);
}
const ROOM_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉 I O 0 1，口頭唸比較不會錯
function newRoom(){ let s = ''; for(let i = 0; i < 6; i++) s += ROOM_CH[cryptoInt(ROOM_CH.length)]; return s; }
function newSecret(){ let s = ''; for(let i = 0; i < 16; i++) s += cryptoInt(36).toString(36); return s; }
function cleanRoom(s){ s = FW(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); return s.length === 6 ? s : ''; }

/* ---------- 現場碼：同一個祕密＋同一個時段 → 同一組 4 位數字（老師重新整理也算得出來） ---------- */
function fnv(str){ let h = 0x811c9dc5; for(const ch of String(str)){ h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
function token(secret, slot){ return String(fnv(secret + '|' + slot) % 10000).padStart(4, '0'); }
function slotOf(now, rotSec){ return rotSec > 0 ? Math.floor(now / (rotSec * 1000)) : 'fixed'; }
// 目前這一格的現場碼與剩幾秒
function curToken(secret, now, rotSec, sessId){
  if(!(rotSec > 0)) return {tok:token(secret, 'fixed:' + sessId), left:0};
  const slot = slotOf(now, rotSec);
  return {tok:token(secret, sessId + ':' + slot), left:Math.ceil(((slot + 1) * rotSec * 1000 - now) / 1000)};
}
// 學生送來的現場碼還有效嗎（最近 windowSec 秒內出現過的任何一組都算）
function tokenOk(secret, tok, now, rotSec, windowSec, sessId){
  tok = String(tok || '');
  if(!/^\d{4}$/.test(tok)) return false;
  if(!(rotSec > 0)) return tok === token(secret, 'fixed:' + sessId);
  const cur = slotOf(now, rotSec), back = Math.max(1, Math.ceil(windowSec / rotSec));
  for(let s = cur; s >= cur - back; s--) if(token(secret, sessId + ':' + s) === tok) return true;
  return false;
}

/* ---------- 名單 ---------- */
const HEAD = {no:/學號|工號|編號|員編|座號|no|id$/i, name:/姓名|名字|name/i, idno:/身分證|身份證|證號|居留證/i, group:/組別|班級|部門|單位|group|class/i};
function splitLine(l){ return /\t/.test(l) ? l.split('\t') : /,/.test(l) ? l.split(',') : l.trim().split(/\s+/); }
// rows：二維陣列（試算表）或文字；回傳 [{no, name, idno, group}]，學號同一個只留第一筆
function parseRoster(input){
  let rows = Array.isArray(input) ? input : String(input || '').split(/\r?\n/).map(splitLine);
  rows = rows.map((r) => (r || []).map((c) => FW(c == null ? '' : c).trim())).filter((r) => r.some(Boolean));
  if(!rows.length) return [];
  const h = rows[0], col = {};
  h.forEach((c, i) => { for(const k in HEAD) if(col[k] == null && HEAD[k].test(c.replace(/\s/g, ''))) { col[k] = i; break; } });
  let body = rows;
  if(col.name != null || col.no != null) body = rows.slice(1);
  else {
    // 沒有標題列：一欄＝姓名；兩欄以上看哪一欄像學號（有數字）
    const first = rows[0];
    if(first.length === 1) col.name = 0;
    else { const ni = first.findIndex((c) => /\d/.test(c)); col.no = ni < 0 ? null : ni; col.name = first.findIndex((c, i) => i !== col.no && c); }
  }
  const seen = new Set(), out = [];
  body.forEach((r) => {
    const p = {no:cut(col.no != null ? r[col.no] : '', 20).replace(/\s/g, ''), name:cut(col.name != null ? r[col.name] : '', 12), idno:cut(col.idno != null ? r[col.idno] : '', 12).toUpperCase(), group:cut(col.group != null ? r[col.group] : '', 12)};
    if(!p.no && !p.name) return;
    const k = keyOf(p);
    if(seen.has(k)) return;
    seen.add(k); out.push(p);
  });
  return out.slice(0, 500);
}
function keyOf(p){ return p.no ? 'n:' + String(p.no).toUpperCase() : 'm:' + p.name; }
// 學生送來的學號＋姓名對到名單：先比學號，再比姓名（轉播站可能把名字的某些字遮成 *）
function match(roster, no, name){
  no = String(no || '').toUpperCase().replace(/\s/g, ''); name = String(name || '').trim();
  if(no){ const r = roster.find((p) => String(p.no).toUpperCase() === no); if(r) return r; }
  if(name && !/\*/.test(name)){ const r = roster.filter((p) => p.name === name); if(r.length === 1 && (!no || !r[0].no)) return r[0]; }
  return null;
}
function maskId(s){ s = String(s || ''); return s.length >= 6 ? s.slice(0, 3) + '****' + s.slice(-3) : s ? s[0] + '***' : ''; }

/* ---------- 手機⇄老師的訊息（轉播站：聊天 ≤60 字、同一人 2.5 秒一則；老師的訊息全班看得到，所以回覆只放手機代號） ---------- */
// 手機 → 老師：C1234:學號|姓名（簽到）、O1234:學號|姓名（簽退）
function encCheck(mode, tok, no, name){ return (mode === 'out' ? 'O' : 'C') + tok + ':' + cut(String(no || '').replace(/[|:\s]/g, ''), 20) + '|' + cut(String(name || '').replace(/[|:]/g, ''), 12); }
function decCheck(t){ const m = /^([CO])(\d{4}):([^|]*)\|(.*)$/.exec(String(t || '')); return m ? {mode:m[1] === 'O' ? 'out' : 'in', tok:m[2], no:m[3].trim(), name:m[4].trim()} : null; }
// 老師 → 全班：K:<手機代號6><結果1>,…；一則最多 7 個（2＋7×7＋6 個逗號＝57 字，聊天上限 60）
const ACK = {1:'簽到成功・準時', 2:'簽到成功・遲到', 3:'已經簽過了', 4:'現場碼過期了，請重新掃投影幕上的 QR', 5:'這支手機已經幫別人簽過，請用自己的手機', 6:'名單上找不到，老師確認後才算數', 7:'簽退成功', 8:'簽退成功・早退', 9:'還沒有簽到紀錄，已記下簽退時間，請找老師確認', 0:'老師還沒開放'};
const ACK_OK = {1:1, 2:1, 3:1, 7:1, 8:1};
function encAcks(list){ const out = []; for(let i = 0; i < list.length; i += 7) out.push('K:' + list.slice(i, i + 7).map((a) => String(a.id).slice(0, 6) + a.c).join(',')); return out; }
function decAcks(t){ const m = /^K:(.*)$/.exec(String(t || '')); if(!m) return []; return m[1].split(',').map((x) => /^([a-z0-9]{6})(\d)$/i.test(x) ? {id:x.slice(0, 6), c:+x.slice(6)} : null).filter(Boolean); }
// 老師的 presence 名字：T|<開放1><模式 i/o><堂次編號2>
function encState(open, mode, idx){ return 'T|' + (open ? 1 : 0) + (mode === 'out' ? 'o' : 'i') + String(idx % 100).padStart(2, '0'); }
function decState(s){ const m = /^T\|([01])([io])(\d{2})/.exec(String(s || '')); return m ? {open:m[1] === '1', mode:m[2] === 'o' ? 'out' : 'in', idx:+m[3]} : null; }
// 課名與堂次名：R:課名¦堂次
function encRoom(course, sess){ return 'R:' + cut(course, 28) + '¦' + cut(sess, 26); }
function decRoom(t){ const m = /^R:([^¦]*)¦?(.*)$/.exec(String(t || '')); return m ? {course:m[1], sess:m[2]} : null; }

/* ---------- 時間 ---------- */
function ts(date, hm){ const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || ''), t = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); if(!m || !t) return NaN; return new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]).getTime(); }
function hm(t){ if(!t) return ''; const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function ymd(t){ const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const WK = '日一二三四五六';
function mdw(date){ const t = ts(date, '00:00'); if(isNaN(t)) return date || ''; const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WK[d.getDay()] + '）'; }
function sessHours(s){ const h = parseFloat(s.hours); if(h > 0) return h; const a = ts(s.date, s.start), b = ts(s.date, s.end); return b > a ? Math.round((b - a) / 36e5 * 2) / 2 : 0; }

/* ---------- 狀態與時數 ---------- */
// 手動狀態：present 出席、late 遲到、early 早退、leave 請假、official 公假（計時數）、absent 缺席
const ST = {present:{n:'出席', s:'✔'}, late:{n:'遲到', s:'遲'}, early:{n:'早退', s:'退'}, lateearly:{n:'遲到早退', s:'遲退'}, leave:{n:'請假', s:'假'}, official:{n:'公假', s:'公'}, absent:{n:'缺席', s:'✖'}, none:{n:'未簽到', s:'－'}, pending:{n:'待確認', s:'？'}};
const DEF_RULE = {late:10, early:10, mode:'actual', unit:0.5, ratio:'2/3'};
function ratioVal(r){ r = String(r || ''); let m = /^(\d+)\s*\/\s*(\d+)$/.exec(r); if(m && +m[2] > 0) return +m[1] / +m[2]; m = /^(\d+(?:\.\d+)?)\s*%$/.exec(r); if(m) return +m[1] / 100; return 0; }
// rec：{in, out, st（老師手動）, how, dev, note}；now 用來判斷這堂結束了沒
function statusOf(rec, sess, rule, now){
  rule = Object.assign({}, DEF_RULE, rule);
  if(rec && rec.st) return rec.st;
  const end = ts(sess.date, sess.end);
  if(!rec || !rec.in){ if(rec && rec.out) return 'pending'; return (now != null && end && now > end) || sess.closed ? 'absent' : 'none'; }
  const start = ts(sess.date, sess.start);
  const late = start && rec.in > start + rule.late * 60000;
  const early = end && rec.out && rec.out < end - rule.early * 60000;
  return late && early ? 'lateearly' : late ? 'late' : early ? 'early' : 'present';
}
function lateMin(rec, sess){ const s = ts(sess.date, sess.start); return rec && rec.in && s && rec.in > s ? Math.round((rec.in - s) / 60000) : 0; }
function earlyMin(rec, sess){ const e = ts(sess.date, sess.end); return rec && rec.out && e && rec.out < e ? Math.round((e - rec.out) / 60000) : 0; }
// 出席時數：full＝有到就算整堂；actual＝依在場時間佔整堂的比例，以 unit 小時為單位無條件捨去
function hoursOf(rec, sess, rule, now){
  rule = Object.assign({}, DEF_RULE, rule);
  const H = sessHours(sess), st = statusOf(rec, sess, rule, now);
  if(st === 'official') return H;
  if(st === 'leave' || st === 'absent' || st === 'none' || st === 'pending') return 0;
  if(rec && rec.st === 'present') return H;
  if(rule.mode === 'full') return H;
  if(st === 'present') return H;
  const a = ts(sess.date, sess.start), b = ts(sess.date, sess.end);
  if(!(b > a) || !rec || (!rec.in && !rec.out)) return rec && rec.st ? H : 0;
  const inT = Math.max(a, rec.in || a), outT = Math.min(b, rec.out || b);
  const frac = Math.max(0, outT - inT) / (b - a);
  const u = rule.unit > 0 ? rule.unit : 0.5;
  return Math.min(H, Math.floor(H * frac / u + 1e-9) * u);
}
// 總表：每位學生每堂的狀態與時數、總時數、出席率、是否達標
function summary(course, now){
  const rule = Object.assign({}, DEF_RULE, course.rule), sess = course.sessions || [];
  const planned = sess.reduce((a, s) => a + sessHours(s), 0);
  const people = (course.roster || []).map((p) => ({p, key:keyOf(p)}));
  // 名單外但有簽到紀錄的人（老師核准過的）也列進來
  sess.forEach((s) => Object.keys(s.recs || {}).forEach((k) => { if(!people.some((x) => x.key === k) && s.recs[k].extra) people.push({p:s.recs[k].extra, key:k, extra:true}); }));
  const ratio = ratioVal(rule.ratio);
  return {planned, ratio, rows:people.map((x) => {
    let att = 0; const cnt = {};
    const cells = sess.map((s) => { const rec = (s.recs || {})[x.key], st = statusOf(rec, s, rule, now), h = hoursOf(rec, s, rule, now); att += h; cnt[st] = (cnt[st] || 0) + 1; return {st, h, rec}; });
    att = Math.round(att * 100) / 100;
    return {p:x.p, key:x.key, extra:!!x.extra, cells, att, cnt, rate:planned ? att / planned : 0, pass:planned > 0 && ratio > 0 ? att + 1e-9 >= planned * ratio : null};
  })};
}
function countSess(course, sess, now){
  const rule = course.rule || {}, c = {present:0, late:0, early:0, lateearly:0, leave:0, official:0, absent:0, none:0, pending:0};
  (course.roster || []).forEach((p) => { c[statusOf((sess.recs || {})[keyOf(p)], sess, rule, now)]++; });
  c.arrived = c.present + c.late + c.early + c.lateearly;
  return c;
}

/* ---------- 匯出列 ---------- */
function exportRows(course, now, withId){
  const S = summary(course, now), sess = course.sessions || [];
  const head = ['學號', '姓名'].concat(withId ? ['身分證字號'] : [], ['組別'], sess.map((s, i) => (i + 1) + '. ' + mdw(s.date) + (s.title ? ' ' + s.title : '')), ['出席時數', '應到時數', '出席率', '達標']);
  const rows = S.rows.map((r) => [r.p.no, r.p.name].concat(withId ? [r.p.idno || ''] : [], [r.p.group || (r.extra ? '名單外' : '')], r.cells.map((c) => ST[c.st].n + (c.h && c.st !== 'present' ? '（' + c.h + 'h）' : '') + (c.rec && c.rec.in ? ' ' + hm(c.rec.in) : '') + (c.rec && c.rec.out ? '–' + hm(c.rec.out) : '')), [r.att, S.planned, Math.round(r.rate * 1000) / 10 + '%', r.pass == null ? '' : r.pass ? '達標' : '未達']));
  return [head].concat(rows);
}
// 給訓練證書產生器：姓名、身分證字號、出席時數（它的名單欄位會自動辨認這三個標題）
function certRows(course, now){
  const S = summary(course, now);
  return [['姓名', '身分證字號', '出席時數', '學號']].concat(S.rows.map((r) => [r.p.name, r.p.idno || '', r.att, r.p.no]));
}
function sessRows(course, sess, now){
  const rule = course.rule || {}, recs = sess.recs || {};
  const keys = (course.roster || []).map(keyOf).concat(Object.keys(recs).filter((k) => !(course.roster || []).some((p) => keyOf(p) === k)));
  return [['學號', '姓名', '狀態', '簽到時間', '簽退時間', '遲到分鐘', '早退分鐘', '出席時數', '方式', '備註']].concat(keys.map((k) => {
    const p = (course.roster || []).find((x) => keyOf(x) === k) || (recs[k] && recs[k].extra) || {no:'', name:k.slice(2)}, rec = recs[k];
    return [p.no, p.name, ST[statusOf(rec, sess, rule, now)].n, rec && rec.in ? hm(rec.in) : '', rec && rec.out ? hm(rec.out) : '', lateMin(rec, sess) || '', earlyMin(rec, sess) || '', hoursOf(rec, sess, rule, now), rec ? (rec.how === 'manual' ? '老師登記' : '掃碼') : '', rec && rec.note || ''];
  }));
}

/* ---------- 範例（全部虛構） ---------- */
function example(){
  const d = new Date(), today = ymd(d.getTime());
  return {name:'示範班：AI 辦公室應用（範例）', unit:'示範職業訓練協會', rule:Object.assign({}, DEF_RULE),
    roster:parseRoster('學號\t姓名\t組別\nA001\t王小明\t第1組\nA002\t陳美玲\t第1組\nA003\t張大同\t第2組\nA004\t李曉華\t第2組\nA005\t黃志明\t第3組\nA006\t林雅婷\t第3組'),
    sessions:[{id:'s1', date:today, start:'09:00', end:'12:00', hours:3, title:'第 1 堂', recs:{}}]};
}

const API = {cut, FW, cryptoInt, newRoom, newSecret, cleanRoom, fnv, token, slotOf, curToken, tokenOk, parseRoster, keyOf, match, maskId,
  encCheck, decCheck, ACK, ACK_OK, encAcks, decAcks, encState, decState, encRoom, decRoom,
  ts, hm, ymd, mdw, sessHours, ST, DEF_RULE, ratioVal, statusOf, lateMin, earlyMin, hoursOf, summary, countSess, exportRows, certRows, sessRows, example};
if(typeof module === 'object' && module.exports) module.exports = API;
root.ATQ = API;
})(typeof window !== 'undefined' ? window : globalThis);

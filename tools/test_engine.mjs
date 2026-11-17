// node tools/test_engine.mjs —— 出席簽到 QR 引擎測試（含轉播站不雅字詞過濾不會遮到我們的訊息）
import {createRequire} from 'module';
import {pathToFileURL, fileURLToPath} from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const P = require('../data.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const BW = await import(pathToFileURL(path.join(here, '..', '..', '..', '互動遊戲', 'startup-island', 'presence-worker', 'badwords.js')).href);
let n = 0, bad = 0;
function ok(c, msg){ n++; if(!c){ bad++; console.log('✗ ' + msg); } }
function eq(a, b, msg){ ok(JSON.stringify(a) === JSON.stringify(b), msg + '：得到 ' + JSON.stringify(a) + '，應為 ' + JSON.stringify(b)); }

// 代碼
for(let i = 0; i < 200; i++){ const r = P.newRoom(); ok(/^[A-HJ-NP-Z2-9]{6}$/.test(r), '房間代碼不含 I O 0 1：' + r); ok(/^[A-Z0-9]{3,12}$/.test('SIGN' + r), '轉播站房名格式'); }
eq(P.cleanRoom(' ab-cd ef '), 'ABCDEF', '代碼整理');
eq(P.cleanRoom('ABC'), '', '代碼太短');

// 現場碼
const sec = 'testsecret123';
const t0 = 1_800_000_000_000;
const a = P.curToken(sec, t0, 20, 's1'), b = P.curToken(sec, t0 + 20000, 20, 's1');
ok(/^\d{4}$/.test(a.tok), '現場碼 4 位數');
ok(a.left >= 1 && a.left <= 20, '剩餘秒數 ' + a.left);
eq(P.curToken(sec, t0, 20, 's1').tok, a.tok, '同時段同一組（重新整理算得出來）');
ok(P.curToken(sec, t0, 20, 's2').tok !== a.tok || P.curToken(sec, t0 + 40000, 20, 's2').tok !== b.tok, '不同堂次不同碼');
ok(P.tokenOk(sec, a.tok, t0 + 60000, 20, 120, 's1'), '2 分鐘內有效');
ok(!P.tokenOk(sec, a.tok, t0 + 200000, 20, 120, 's1') || a.tok === P.curToken(sec, t0 + 200000, 20, 's1').tok, '超過有效時間失效');
ok(!P.tokenOk(sec, '12a4', t0, 20, 120, 's1'), '格式不對');
ok(!P.tokenOk(sec, a.tok, t0, 20, 120, 's9') || P.curToken(sec, t0, 20, 's9').tok === a.tok, '別堂的碼不能用');
const fx = P.curToken(sec, t0, 0, 's1');
eq(fx.left, 0, '固定碼不倒數');
ok(P.tokenOk(sec, fx.tok, t0 + 86400000, 0, 120, 's1'), '固定碼一直有效');
// 抽樣：現場碼分布不要太集中
const seen = new Set(); for(let s = 0; s < 2000; s++) seen.add(P.token(sec, 's1:' + s)); ok(seen.size > 1600, '現場碼分布 ' + seen.size + '/2000');

// 名單
let R = P.parseRoster('學號\t姓名\t組別\t身分證字號\nA001\t王小明\t1\ta123456789\nA002\t陳美玲\t2\t\nA001\t重複\t\t\n\n');
eq(R.length, 2, '去重、空行');
eq(R[0], {no:'A001', name:'王小明', idno:'A123456789', group:'1'}, '欄位對應、身分證轉大寫');
R = P.parseRoster('王小明\n陳美玲');
eq(R.map((p) => p.name), ['王小明', '陳美玲'], '只有姓名一欄');
R = P.parseRoster('1101 王小明\n1102 陳美玲');
eq(R.map((p) => [p.no, p.name]), [['1101', '王小明'], ['1102', '陳美玲']], '沒標題：學號＋姓名');
R = P.parseRoster([['姓名', '工號'], ['吳家豪', 'E01'], ['蔡佩君', 'E02']]);
eq(R.map((p) => p.no), ['E01', 'E02'], '二維陣列、欄位順序不同');
R = P.parseRoster('學號,姓名\nＡ００３,張大同');
eq(R[0].no, 'A003', '全形學號轉半形');
const roster = P.parseRoster('學號\t姓名\nA001\t王小明\nA002\t陳美玲\n\t林無號');
eq(P.match(roster, 'a001', '亂打').name, '王小明', '學號比對（大小寫不分）');
eq(P.match(roster, '', '陳美玲').no, 'A002', '沒填學號用姓名');
eq(P.match(roster, 'A999', '陳美玲'), null, '學號打錯不亂配（避免冒名）');
eq(P.match(roster, '', '陳*玲'), null, '姓名被遮字不比對');
eq(P.match(roster, '', '林無號').name, '林無號', '名單沒學號的人用姓名');
eq(P.maskId('A123456789'), 'A12****789', '身分證遮罩');

// 訊息
const enc = P.encCheck('in', '0427', 'A001', '王小明');
eq(enc, 'C0427:A001|王小明', '簽到訊息');
eq(P.decCheck(enc), {mode:'in', tok:'0427', no:'A001', name:'王小明'}, '解簽到');
eq(P.decCheck(P.encCheck('out', '9999', 'A|B:C', '名|字')), {mode:'out', tok:'9999', no:'ABC', name:'名字'}, '分隔符號被拿掉');
ok(P.encCheck('in', '1234', 'X'.repeat(30), '長'.repeat(30)).length <= 60, '訊息不超過 60 字');
eq(P.decCheck('亂七八糟'), null, '不是簽到訊息');
const acks = [];
for(let i = 0; i < 19; i++) acks.push({id:String(100000000000 + i * 7919), c:i % 10});
const ka = P.encAcks(acks);
eq(ka.length, 3, '19 個回覆分 3 則（一則 7 個）');
ok(ka.every((t) => t.length <= 60), '回覆每則 ≤60 字');
eq([].concat(...ka.map(P.decAcks)), acks.map((x) => ({id:x.id.slice(0, 6), c:x.c})), '回覆解回來一樣');
eq(P.decState(P.encState(true, 'out', 3)), {open:true, mode:'out', idx:3}, '老師狀態');
eq(P.decState('S'), null, '學生不是老師狀態');
eq(P.decRoom(P.encRoom('AI 辦公室應用', '第 1 堂')), {course:'AI 辦公室應用', sess:'第 1 堂'}, '課名');
ok(Object.keys(P.ACK).length === 10 && P.ACK_OK[1] && !P.ACK_OK[4], '回覆代碼');

// 轉播站過濾：數字手機代號＋各種結果代碼的回覆、老師狀態、簽到訊息都不能被遮
for(let i = 0; i < 3000; i++){
  let id = ''; while(id.length < 12) id += P.cryptoInt(10);
  const t = P.encAcks([{id, c:i % 10}, {id:'000000', c:0}, {id:'555555', c:5}])[0];
  if(BW.maskBadWords(t) !== t){ ok(false, '回覆被遮：' + t); break; }
}
ok(true, '3000 組隨機數字代號回覆都不會被遮');
['T|1i00', 'T|0o99', 'T|1o05'].forEach((s) => ok(!BW.hasBadWord(s), '老師狀態名字不被換成旅人：' + s));
for(let i = 0; i < 2000; i++){ const tok = String(i * 5).padStart(4, '0').slice(-4); const t = P.encCheck(i % 2 ? 'out' : 'in', tok, 'A' + i, '王小明'); if(BW.maskBadWords(t) !== t){ ok(false, '簽到訊息被遮：' + t); break; } }
ok(true, '2000 組簽到訊息不被遮');
ok(BW.maskBadWords(P.encCheck('in', '1234', 'A001', '幹你')) !== P.encCheck('in', '1234', 'A001', '幹你'), '（對照）姓名有不雅字會被遮，所以以學號比對為主');

// 時間
eq(P.hm(new Date(2026, 10, 17, 9, 5).getTime()), '09:05', '時分');
eq(P.mdw('2026-11-17'), '11/17（二）', '月日星期');
eq(P.sessHours({date:'2026-11-17', start:'09:00', end:'12:00'}), 3, '時數依起訖');
eq(P.sessHours({date:'2026-11-17', start:'09:00', end:'16:00', hours:'6'}), 6, '有填時數用填的（午休）');

// 狀態與時數
const S1 = {date:'2026-11-17', start:'09:00', end:'12:00', hours:3};
const at = (h, m) => new Date(2026, 10, 17, h, m).getTime();
const rule = {late:10, early:10, mode:'actual', unit:0.5, ratio:'2/3'};
eq(P.statusOf({in:at(9, 5)}, S1, rule), 'present', '寬限內準時');
eq(P.statusOf({in:at(9, 11)}, S1, rule), 'late', '超過寬限遲到');
eq(P.statusOf({in:at(8, 50), out:at(11, 40)}, S1, rule), 'early', '早退');
eq(P.statusOf({in:at(9, 30), out:at(11, 0)}, S1, rule), 'lateearly', '遲到又早退');
eq(P.statusOf(null, S1, rule, at(10, 0)), 'none', '上課中還沒到');
eq(P.statusOf(null, S1, rule, at(12, 1)), 'absent', '下課後沒到＝缺席');
eq(P.statusOf(null, Object.assign({closed:true}, S1), rule, at(10, 0)), 'absent', '老師結束簽到＝缺席');
eq(P.statusOf({out:at(12, 0)}, S1, rule, at(12, 5)), 'pending', '只有簽退沒簽到＝待確認');
eq(P.statusOf({in:at(10, 0), st:'leave'}, S1, rule), 'leave', '手動狀態優先');
eq(P.hoursOf({in:at(9, 5)}, S1, rule), 3, '準時＝整堂');
eq(P.hoursOf({in:at(9, 40)}, S1, rule), 2, '遲到 40 分：剩 2:20 → 捨去到 2 小時');
eq(P.hoursOf({in:at(9, 0), out:at(11, 0)}, S1, rule), 2, '早退 1 小時 → 2 小時');
eq(P.hoursOf({in:at(9, 40)}, S1, Object.assign({}, rule, {mode:'full'})), 3, '有到就算整堂');
eq(P.hoursOf({st:'leave'}, S1, rule), 0, '請假 0');
eq(P.hoursOf({st:'official'}, S1, rule), 3, '公假計時數');
eq(P.hoursOf({st:'present'}, S1, rule), 3, '老師手動出席給整堂');
eq(P.hoursOf(null, S1, rule, at(13, 0)), 0, '缺席 0');
const S6 = {date:'2026-11-17', start:'09:00', end:'16:00', hours:6};
eq(P.hoursOf({in:at(10, 10)}, S6, rule), 5, '有午休：遲到 70 分，6×(350/420)＝5 小時');
eq(P.hoursOf({in:at(10, 20)}, S6, rule), 4.5, '遲到 80 分，6×(340/420)＝4.86 → 捨去到 4.5');
eq(P.lateMin({in:at(9, 23)}, S1), 23, '遲到分鐘');
eq(P.earlyMin({out:at(11, 15)}, S1), 45, '早退分鐘');
eq(P.ratioVal('2/3'), 2 / 3, '門檻 2/3'); eq(P.ratioVal('80%'), .8, '門檻 80%'); eq(P.ratioVal(''), 0, '不判斷');

// 總表
const course = {name:'測試', rule, roster:P.parseRoster('學號\t姓名\nA1\t甲\nA2\t乙\nA3\t丙'), sessions:[
  {id:'s1', date:'2026-11-10', start:'09:00', end:'12:00', hours:3, recs:{'n:A1':{in:new Date(2026, 10, 10, 9, 0).getTime()}, 'n:A2':{in:new Date(2026, 10, 10, 9, 40).getTime()}, 'n:X9':{in:new Date(2026, 10, 10, 9, 1).getTime(), extra:{no:'X9', name:'旁聽'}}}},
  {id:'s2', date:'2026-11-17', start:'09:00', end:'12:00', hours:3, recs:{'n:A1':{in:new Date(2026, 10, 17, 9, 0).getTime()}, 'n:A3':{st:'official'}}}]};
const SM = P.summary(course, new Date(2026, 10, 18).getTime());
eq(SM.planned, 6, '應到時數');
eq(SM.rows.map((r) => [r.p.name, r.att, r.pass]), [['甲', 6, true], ['乙', 2, false], ['丙', 3, false], ['旁聽', 3, false]], '總表時數與達標（名單外的人列在最後）');
eq(SM.rows[1].cells.map((c) => c.st), ['late', 'absent'], '乙：遲到、缺席');
const cnt = P.countSess(course, course.sessions[0], new Date(2026, 10, 18).getTime());
eq([cnt.arrived, cnt.late, cnt.absent], [2, 1, 1], '單堂人數');
const X = P.exportRows(course, new Date(2026, 10, 18).getTime(), false);
eq(X[0].slice(-4), ['出席時數', '應到時數', '出席率', '達標'], '匯出表頭');
eq(X.length, 5, '匯出列數');
const CR = P.certRows(course, new Date(2026, 10, 18).getTime());
eq(CR[0].slice(0, 3), ['姓名', '身分證字號', '出席時數'], '給證書產生器的欄位');
eq(CR[1].slice(0, 3), ['甲', '', 6], '時數帶出');
const SR = P.sessRows(course, course.sessions[0], new Date(2026, 10, 18).getTime());
eq(SR[2].slice(0, 6), ['A2', '乙', '遲到', '09:40', '', 40], '單堂紀錄：遲到 40 分');
eq(SR[4][1], '旁聽', '名單外也列出');

// 範例
const ex = P.example();
ok(ex.roster.length === 6 && ex.sessions.length === 1 && ex.sessions[0].date === P.ymd(Date.now()), '範例：6 人、今天一堂');

console.log((bad ? '✗ ' : '✓ ') + (n - bad) + '/' + n + ' 項通過');
process.exit(bad ? 1 : 0);

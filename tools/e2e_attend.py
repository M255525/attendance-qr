# 端對端測試：python tools/e2e_attend.py [輸出資料夾]（需先開 8892；線上版設 ATQ_BASE）
# 連「正式」創業島轉播站（隨機 SIGN 房間），老師一個瀏覽器、每支「手機」各一個獨立瀏覽器環境。
import os, sys, io, asyncio, zipfile
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
from playwright.async_api import async_playwright

BASE = os.environ.get('ATQ_BASE', 'http://localhost:8892/')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('TEMP', '.'), 'atq_e2e')
os.makedirs(OUT, exist_ok=True)
fails = []
def check(c, msg):
    print(('✓ ' if c else '✗ ') + msg)
    if not c: fails.append(msg)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        def watch(pg, who):
            pg.on('pageerror', lambda e: errs.append(who + ': ' + str(e)))
            pg.on('console', lambda m: errs.append(who + ': ' + m.text) if m.type == 'error' and 'visitor-badge' not in m.text and 'script.google' not in m.text else None)
        tc = await b.new_context(viewport={'width': 1300, 'height': 900}, accept_downloads=True)
        T = await tc.new_page(); watch(T, '老師')
        await T.goto(BASE); await T.wait_for_function('window._atq')
        check(await T.is_visible('#modal.show') and '防不了所有作弊' in await T.text_content('#modalBox'), '首訪警語（說明防不了所有代簽）')
        await T.click('#modal [data-act=close]')
        check(await T.locator('.tcard').count() == 6, '範例課程 6 張出勤卡')
        check(await T.is_visible('a[href="manual.html"]') and await T.is_visible('.foot a[href="manual.html#creator"]') and await T.is_visible('.foot [data-act=install]') and await T.locator('.foot img[src*="attendanceqr"]').count() == 1 and await T.is_visible('.warn-line [data-act=warn]'), '五件套入口')
        # 讓這堂課「剛開始 5 分鐘」，才能測準時
        await T.evaluate('''(()=>{const A=window._atq, P=window.ATQ, s=A.C.sessions[0], n=Date.now();
          s.date=P.ymd(n); s.start=P.hm(n-5*60000); var e=Math.min(n+150*60000, new Date(new Date(n).setHours(23,59,0,0)).getTime()); s.end=P.hm(e); s.hours=''; A.render();})()''')
        await T.click('[data-act=start]')
        await T.wait_for_function('window._atq.NET.status==="on"', timeout=15000)
        await T.wait_for_function('window._atq.QR.img && window._atq.QR.img.length>100', timeout=15000)
        check(await T.is_visible('.qrpanel img[data-qr]'), '開始簽到：出現 QR、現場碼')
        room = await T.evaluate('window._atq.C.room')
        def tok(): return T.evaluate('(()=>{const A=window._atq,P=window.ATQ;return P.curToken(A.C.secret,Date.now(),A.CFG.rot,A.C.sessions[0].id).tok})()')
        url = await T.evaluate('window._atq.QR.url')
        check(('join=' + room) in url and '&k=' in url, 'QR 內容含教室代碼與現場碼')

        phones = []
        async def phone(name, k=None, w=390):
            ctx = await b.new_context(viewport={'width': w, 'height': 800}); pg = await ctx.new_page(); watch(pg, name)
            kk = k if k is not None else await tok()
            await pg.goto(BASE + '?join=' + room + ('&k=' + kk if kk else '')); await pg.wait_for_function('window._atq && window._atq.NET.status==="on"', timeout=15000)
            await pg.wait_for_timeout(500); phones.append(ctx); return pg
        async def sign(pg, no, nm, k=None):
            await pg.fill('#meNo', no); await pg.fill('#meName', nm)
            if k is not None: await pg.fill('#meK', k)
            await pg.click('[data-send]')
            await pg.wait_for_function('window._atq.S.phase==="done" || window._atq.S.phase==="slow"', timeout=40000)
            return await pg.evaluate('window._atq.S.res ? window._atq.S.res.c : -1')

        A = await phone('王小明')
        check('AI 辦公室應用' in await A.text_content('.scard'), '手機看到課名（老師的 R: 訊息）')
        await A.fill('#meName', '打到一半'); await A.evaluate('window._atq.S.onPeers()')
        check(await A.input_value('#meName') == '打到一半', '打字時畫面更新不會清掉輸入')
        c = await sign(A, 'A001', '王小明')
        check(c == 1 and '準時' in await A.text_content('.res'), '王小明：簽到成功・準時')
        await A.screenshot(path=os.path.join(OUT, 'phone_ok.png'))
        await T.wait_for_timeout(300)
        check('準時' not in await T.text_content('.tcard >> nth=0') and await T.evaluate('!!window._atq.C.sessions[0].recs["n:A001"].in'), '老師端記下王小明簽到時間')
        # 遲到
        await T.evaluate('''(()=>{const A=window._atq,P=window.ATQ,s=A.C.sessions[0];s.start=P.hm(Date.now()-40*60000);})()''')
        Bp = await phone('陳美玲')
        c = await sign(Bp, 'a002', '陳美玲')
        check(c == 2 and '遲到' in await Bp.text_content('.res'), '陳美玲（學號小寫）：遲到')
        # 同一支手機幫別人
        await Bp.goto(BASE + '?join=' + room + '&k=' + await tok()); await Bp.wait_for_function('window._atq.NET.status==="on"'); await Bp.wait_for_timeout(400)
        check(await Bp.input_value('#meName') == '陳美玲', '同一支手機記得上次的學號姓名')
        c = await sign(Bp, 'A003', '張大同')
        check(c == 5, '同一支手機幫張大同簽：擋下（代碼 5）')
        await T.wait_for_timeout(400)
        check('同一支手機' in await T.text_content('#main'), '老師端出現代簽提醒')
        # 重複簽
        await A.goto(BASE + '?join=' + room + '&k=' + await tok()); await A.wait_for_function('window._atq.NET.status==="on"'); await A.wait_for_timeout(400)
        c = await sign(A, 'A001', '王小明')
        check(c == 3, '王小明再簽一次：已經簽過了')
        # 現場碼過期 → 手動輸入
        Cp = await phone('張大同', k='0000' if await tok() != '0000' else '0001')
        c = await sign(Cp, 'A003', '張大同')
        check(c == 4 and await Cp.is_visible('[data-again]'), '過期現場碼：請重新輸入')
        await Cp.click('[data-again]')
        check(await Cp.is_visible('#meK'), '過期後改成手動輸入現場碼')
        c = await sign(Cp, 'A003', '張大同', k=await tok())
        check(c in (1, 2), '輸入投影幕上的現場碼後簽到成功')
        # 名單外
        Dp = await phone('旁聽生')
        c = await sign(Dp, 'X999', '旁聽生')
        check(c == 6, '名單外：等老師確認')
        await T.wait_for_timeout(400)
        check('名單上找不到' in await T.text_content('#main'), '老師端出現名單外提醒')
        await Dp.evaluate('window._atq.S.phase="wait"')
        await T.click('[data-pok="0"]')
        await Dp.wait_for_function('window._atq.S.res && window._atq.S.res.c===1', timeout=30000)
        check(await T.evaluate('window._atq.C.roster.some(p=>p.name==="旁聽生" && p.group==="名單外")'), '老師按加進名單：手機收到成功、名單多一人')
        # 沒有現場碼的網址（手動輸入）
        Ep = await phone('林雅婷', k='')
        check(await Ep.is_visible('#meK'), '直接打開網址：要輸入現場碼')
        await Ep.fill('#meNo', 'A006'); await Ep.fill('#meName', '林雅婷'); await Ep.click('[data-send]')
        check('現場碼' in await Ep.text_content('.scard'), '沒填現場碼不送出')
        c = await sign(Ep, 'A006', '林雅婷', k=await tok())
        check(c in (1, 2), '手動輸入現場碼簽到')
        await T.screenshot(path=os.path.join(OUT, 'teacher.png'), full_page=True)
        # 投影
        await T.click('[data-act=proj]')
        check(await T.is_visible('#proj .pjl img') and '已到' in await T.text_content('#proj'), '投影 QR 全螢幕')
        await T.screenshot(path=os.path.join(OUT, 'proj.png'))
        await T.keyboard.press('Escape')
        check(await T.is_hidden('#proj'), 'Esc 關投影')
        # 簽退
        await T.click('[data-mode=out]')
        await A.goto(BASE + '?join=' + room + '&k=' + await tok()); await A.wait_for_function('window._atq.NET.status==="on"')
        await A.wait_for_function('window._atq.S.teacher && window._atq.S.teacher.mode==="out"', timeout=15000)
        check('簽退' in await A.text_content('[data-send]'), '老師切簽退：手機按鈕變簽退')
        c = await sign(A, 'A001', '王小明')
        check(c in (7, 8), '王小明簽退成功（代碼 %d）' % c)
        await T.wait_for_timeout(300)
        check(await T.evaluate('!!window._atq.C.sessions[0].recs["n:A001"].out'), '老師端記下簽退時間')
        # 手動登記
        await T.click('.tcard[data-who="n:A004"]')
        await T.select_option('#wSt', 'leave'); await T.fill('#wNote', '病假')
        await T.click('[data-whosave="n:A004"]')
        check('請假' in await T.text_content('.tcard[data-who="n:A004"]'), '手動改成請假')
        await T.click('.tcard[data-who="n:A005"]'); await T.click('[data-act=whoNow]'); await T.click('[data-whosave="n:A005"]')
        check('老師登記' in await T.text_content('.tcard[data-who="n:A005"]'), '老師幫忙補簽（現在到了）')
        cnt = await T.text_content('.counts')
        cn = cnt.replace(' ', '')
        check('已到6／7' in cn and '請假1' in cn and '未到0' in cn, '人數統計（6 到、1 請假、0 未到）' + cn)
        # 總表
        await T.click('[data-act=summary]')
        check(await T.locator('table.sum tr').count() == 8, '總表 7 人（含名單外）')
        await T.screenshot(path=os.path.join(OUT, 'summary.png'))
        await T.click('#modal [data-act=export]')
        async with T.expect_download() as dl:
            await T.click('[data-act=xCert]')
        d = await dl.value; fn = os.path.join(OUT, 'cert.xlsx'); await d.save_as(fn)
        xml = zipfile.ZipFile(fn).read('xl/worksheets/sheet1.xml').decode('utf-8')
        check('出席時數' in xml and '身分證字號' in xml and '王小明' in xml, '給訓練證書產生器的 Excel（姓名、身分證字號、出席時數）')
        async with T.expect_download() as dl:
            await T.click('[data-act=xSumX]')
        d = await dl.value; fn2 = os.path.join(OUT, 'sum.xlsx'); await d.save_as(fn2)
        check(zipfile.ZipFile(fn2).testzip() is None, '出席總表 Excel')
        async with T.expect_download() as dl:
            await T.click('[data-act=xSess]')
        d = await dl.value; t = open(await d.path(), encoding='utf-8-sig').read()
        check('遲到' in t and '老師登記' in t and '病假' in t, '單堂紀錄 CSV（遲到、老師登記、備註）')
        await T.click('#modal [data-act=close]')
        await T.evaluate('window._atq.preparePrint("sess")')
        pdf = await T.pdf(prefer_css_page_size=True, print_background=True)
        try:
            import fitz
            dd = fitz.open(stream=pdf, filetype='pdf'); check(dd.page_count == 1 and dd[0].rect.height > dd[0].rect.width, '簽到表列印 1 頁直式'); dd[0].get_pixmap(dpi=60).save(os.path.join(OUT, 'print_sess.png'))
            await T.evaluate('window._atq.preparePrint("sum")')
            dd = fitz.open(stream=await T.pdf(prefer_css_page_size=True, print_background=True), filetype='pdf'); check(dd[0].rect.width > dd[0].rect.height, '出席總表列印橫式'); dd[0].get_pixmap(dpi=60).save(os.path.join(OUT, 'print_sum.png'))
        except ImportError: pass
        await T.evaluate('document.getElementById("printArea").innerHTML=""')
        # 結束簽到
        await T.click('[data-act=stop]')
        await A.wait_for_function('window._atq.S.closed===4004', timeout=15000)
        check('結束' in await A.text_content('.scard'), '結束簽到：手機顯示已結束')
        check(await T.evaluate('window._atq.C.room') != room, '換新教室代碼，舊連結失效')
        # 重新整理保留
        await T.reload(); await T.wait_for_function('window._atq')
        check(await T.evaluate('Object.keys(window._atq.C.sessions[0].recs).length') >= 6, '重新整理後紀錄還在')
        # 版面
        await T.set_viewport_size({'width': 400, 'height': 800})
        check(await T.evaluate('document.documentElement.scrollWidth') <= 401, '老師端 400px 不橫捲')
        await T.screenshot(path=os.path.join(OUT, 'teacher_400.png'))
        m = await b.new_page(viewport={'width': 375, 'height': 760})
        await m.goto(BASE + '?join=' + room + '&k=1234'); await m.wait_for_timeout(1500)
        check(await m.evaluate('document.documentElement.scrollWidth') <= 376, '手機端 375px 不橫捲')
        await m.screenshot(path=os.path.join(OUT, 'phone_closed.png'))
        for ctx in phones: await ctx.close()
        check(not errs, '沒有 console 錯誤 ' + str(errs[:3]))
        await b.close()
    print('\n%s %d 項失敗' % ('✗' if fails else '✓', len(fails)))
    sys.exit(1 if fails else 0)
asyncio.run(main())

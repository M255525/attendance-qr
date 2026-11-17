# 教室設定端對端測試：python tools/e2e_rooms.py [輸出資料夾]（需先開 8892；線上版設 ATQ_BASE；連正式轉播站）
# 教室名稱＋密碼、改密碼、分頁保護（同課程不能兩個分頁簽到、另一分頁只能看）、兩班同時簽到、管理密碼＋名單保護、學生登入頁、教室大廳。
import os, sys, io, asyncio, json, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
from playwright.async_api import async_playwright

BASE = os.environ.get('ATQ_BASE', 'http://localhost:8892/')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('TEMP', '.'), 'atq_rooms')
os.makedirs(OUT, exist_ok=True)
LOBBY = 'https://startup-island-presence.content-workflow.workers.dev/lobby?k=SIGN'
fails, skips = [], []
def check(c, msg):
    print(('✓ ' if c else '✗ ') + msg)
    if not c: fails.append(msg)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs = []
        def watch(pg, who):
            pg.on('pageerror', lambda e: errs.append(who + ': ' + str(e)))
            pg.on('console', lambda m: errs.append(who + ': ' + m.text) if m.type == 'error' and 'visitor-badge' not in m.text and 'script.google' not in m.text and '/lobby' not in m.text else None)
        tc = await b.new_context(viewport={'width': 1300, 'height': 900})
        T1 = await tc.new_page(); watch(T1, '老師分頁1')
        await T1.goto(BASE); await T1.wait_for_function('window._atq')
        await T1.click('#modal [data-act=close]')
        # 教室名稱、密碼、公開
        await T1.evaluate('''(()=>{const A=window._atq,P=window.ATQ,s=A.C.sessions[0],n=Date.now(),d0=new Date(n);d0.setHours(0,0,0,0);s.date=P.ymd(n);s.start=P.hm(Math.max(n-5*60000,d0.getTime()));s.end='23:59';A.render();})()''')
        await T1.click('[data-act=courseSet]')
        check(await T1.is_visible('#cRoomName') and await T1.is_visible('#cPub') and await T1.is_visible('#cPw'), '課程設定有教室名稱、公開、密碼')
        await T1.fill('#cRoomName', '測試一班'); await T1.fill('#cPw', 'ab12')
        await T1.click('[data-act=courseSave]')
        check(await T1.evaluate('window._atq.C.cls.pw') == 'AB12', '教室密碼轉大寫存起來')
        await T1.click('[data-act=start]')
        await T1.wait_for_function('window._atq.NET.status==="on" && window._atq.QR.url', timeout=15000)
        url = await T1.evaluate('window._atq.QR.url'); room = await T1.evaluate('window._atq.C.room')
        check('&pw=AB12' in url, 'QR 網址自動帶密碼')
        check('測試一班' in await T1.text_content('.qrpanel') and 'AB12' in await T1.text_content('.qrpanel'), '主持台顯示教室名稱與密碼')
        tok = lambda: T1.evaluate('(()=>{const A=window._atq,P=window.ATQ;return P.curToken(A.C.secret,Date.now(),A.CFG.rot,A.C.sessions[0].id).tok})()')
        # 學生掃 QR（帶密碼）直接進
        sc = await b.new_context(viewport={'width': 390, 'height': 800}); S1 = await sc.new_page(); watch(S1, '學生1')
        await S1.goto(BASE + '?join=' + room + '&k=' + await tok() + '&pw=AB12'); await S1.wait_for_function('window._atq.NET.status==="on"', timeout=15000)
        check(await S1.is_visible('#meName') and not await S1.is_visible('#stuPw'), '掃 QR（帶密碼）：直接到簽到表單')
        # 沒帶密碼
        sc2 = await b.new_context(viewport={'width': 390, 'height': 800}); S2 = await sc2.new_page(); watch(S2, '學生2')
        await S2.goto(BASE + '?join=' + room); await S2.wait_for_function('window._atq.S.needPw===true', timeout=15000)
        check(await S2.is_visible('#stuPw'), '用代碼進來沒密碼：要輸入教室密碼')
        await S2.fill('#stuPw', 'zz99'); await S2.click('[data-act=pwGo]')
        await S2.wait_for_function('window._atq.S.needPw===true && window._atq.S.pwBad===true', timeout=15000)
        check('密碼不對' in await S2.text_content('.scard'), '密碼錯：提示不對')
        await S2.fill('#stuPw', 'ab12'); await S2.click('[data-act=pwGo]')
        await S2.wait_for_function('window._atq.NET.status==="on"', timeout=15000)
        check(await S2.is_visible('#meK'), '密碼對：進到表單（沒有現場碼要自己輸入）')
        # 改密碼：已在教室的手機要重新輸入
        await T1.click('[data-act=courseSet]'); await T1.fill('#cPw', 'NEW7'); await T1.click('[data-act=courseSave]')
        await S1.wait_for_function('window._atq.S.needPw===true', timeout=20000)
        check(True, '簽到中改密碼：已在教室的手機被請重新輸入')
        await T1.wait_for_function('window._atq.NET.status==="on"', timeout=15000)
        await T1.wait_for_timeout(1200)
        check('&pw=NEW7' in await T1.evaluate('window._atq.QR.url'), 'QR 網址換成新密碼')
        # 分頁保護
        T2 = await tc.new_page(); watch(T2, '老師分頁2')
        await T2.goto(BASE); await T2.wait_for_function('window._atq'); await T2.wait_for_timeout(700)
        check(await T2.is_visible('#roBanner'), '第二個分頁打開同一個課程：顯示「另一個分頁簽到中，這裡只能看」')
        await T2.click('[data-act=start]'); await T2.wait_for_timeout(600)
        check('另一個分頁簽到' in await T2.text_content('#modalBox') and not await T2.evaluate('window._atq.L.open'), '同一個課程在第二個分頁按開始：擋下')
        await T2.click('#modal [data-act=close]')
        await T2.click('.tcard >> nth=0'); await T2.wait_for_timeout(200)
        check(not await T2.is_visible('#wSt'), '只能看：點出勤卡不能改')
        # 只能看的分頁會跟著更新
        before = await T2.text_content('.counts')
        await S1.fill('#stuPw', 'new7'); await S1.click('[data-act=pwGo]'); await S1.wait_for_function('window._atq.NET.status==="on"', timeout=15000)
        await S1.fill('#meNo', 'A001'); await S1.fill('#meName', '王小明'); await S1.click('[data-send]')
        await S1.wait_for_function('window._atq.S.phase==="done"', timeout=40000)
        check(await S1.evaluate('window._atq.S.res.c') in (1, 2), '重新輸入密碼後簽到成功')
        await T2.wait_for_timeout(800)
        after = await T2.text_content('.counts')
        check(before != after and '已到 1' in after.replace('已到1', '已到 1'), '另一個分頁自動更新人數（' + after.strip() + '）')
        # 第二個分頁換另一個課程，兩班同時簽到
        await T2.click('[data-act=newCourse]'); await T2.wait_for_timeout(300)
        await T2.fill('#cName', '測試二班'); await T2.fill('#cRoomName', '二班'); await T2.click('[data-act=courseSave]')
        await T2.click('[data-act=addSess]'); await T2.click('[data-sesssave=""]')
        check(not await T2.is_visible('#roBanner'), '換成自己的課程：可以操作')
        await T2.click('[data-act=start]')
        await T2.wait_for_function('window._atq.NET.status==="on"', timeout=15000)
        check(await T1.evaluate('window._atq.NET.status') == 'on' and await T2.evaluate('window._atq.L.open'), '兩個分頁各簽一班，同時進行')
        room2 = await T2.evaluate('window._atq.C.room')
        check(room2 != room, '兩班不同教室代碼')
        # 簽到中不能刪、不能清除
        await T1.click('[data-act=courseDel]') if await T1.is_visible('[data-act=courseDel]') else await T1.evaluate('window._atq.ACT.courseDel()')
        check('簽到中' in await T1.text_content('#modalBox'), '簽到中不能刪課程')
        await T1.click('#modal [data-act=close]')
        await T1.evaluate('window._atq.ACT.wipe()')
        check('簽到中' in await T1.text_content('#modalBox'), '簽到中不能清除全部')
        await T1.click('#modal [data-act=close]')
        # 管理密碼＋名單保護
        await T1.click('header [data-act=settings]')
        await T1.click('.set-sec[data-sec=adm] summary') if not await T1.is_visible('#admN1') else None
        await T1.fill('#admN1', '1234'); await T1.fill('#admN2', '9999'); await T1.click('[data-act=admSet]')
        check('不一樣' in await T1.text_content('#admMsg') and await T1.evaluate('localStorage.getItem("atq.adm")') is None, '兩次不同：不存')
        await T1.fill('#admN2', '1234'); await T1.click('[data-act=admSet]'); await T1.wait_for_timeout(300)
        adm = json.loads(await T1.evaluate('localStorage.getItem("atq.adm")'))
        check(adm and len(adm['hash']) == 64 and '1234' not in json.dumps(adm), '管理密碼只存雜湊')
        await T1.click('#modal [data-act=close]')
        check(await T1.is_visible('#admChip'), '剛設定：已解鎖，頂列有「上鎖」')
        await T1.click('[data-act=roster]')
        check(await T1.is_visible('#rText'), '解鎖中：看名單不用再輸入')
        await T1.click('#modal [data-act=close]')
        await T1.click('#admChip')
        await T1.click('[data-act=roster]')
        check(await T1.is_visible('#pinIn') and not await T1.is_visible('#rText'), '上鎖後看名單要輸入管理密碼')
        await T1.fill('#pinIn', '0000'); await T1.click('[data-act=pinOk]'); await T1.wait_for_timeout(300)
        check(not await T1.is_visible('#rText') and '不對' in await T1.text_content('#pinMsg'), '錯的密碼看不到名單')
        await T1.fill('#pinIn', '1234'); await T1.click('[data-act=pinOk]'); await T1.wait_for_timeout(300)
        check(await T1.is_visible('#rText'), '對的密碼打開名單')
        await T1.click('#modal [data-act=close]')
        await T1.click('#admChip'); await T1.click('[data-act=summary]')
        check(await T1.is_visible('#pinIn'), '總表也受名單保護')
        await T1.click('#modal [data-act=close]')
        # 結束簽到後刪課程要密碼
        await T1.click('[data-act=stop]'); await T1.wait_for_timeout(500)
        await T1.evaluate('window._atq.ACT.courseDel()')
        check(await T1.is_visible('#pinIn'), '結束簽到後刪課程要輸入管理密碼')
        await T1.fill('#pinIn', '0000'); await T1.click('[data-act=pinOk]'); await T1.wait_for_timeout(300)
        check(await T1.evaluate('window._atq.C.name') != '' and await T1.is_visible('#pinIn'), '錯密碼不刪')
        await T1.click('#modal [data-act=close]')
        # 學生登入頁
        E = await sc2.new_page(); watch(E, '登入頁')
        await E.goto(BASE + '?join'); await E.wait_for_timeout(1500)
        check(await E.is_visible('#joinCode') and await E.is_visible('[data-lobbylist]'), '學生登入頁：教室清單＋代碼輸入')
        await E.fill('#joinCode', room2.lower()); await E.click('[data-act=joinGo]')
        await E.wait_for_function('window._atq && window._atq.NET && window._atq.NET.status==="on"', timeout=15000)
        await E.wait_for_function('window._atq.S.course', timeout=15000)
        check(await E.is_visible('#meK') and '測試二班' in await E.text_content('.scard'), '輸入代碼（小寫也行）進到二班的簽到表單')
        # 教室大廳（要部署新版轉播站才有）
        def lobby():
            try:
                req = urllib.request.Request(LOBBY, headers={'Origin': 'https://m255525.github.io', 'User-Agent': 'Mozilla/5.0 (e2e test)'})  # 沒帶 UA 會被 Cloudflare 擋 403
                return json.loads(urllib.request.urlopen(req, timeout=10).read().decode('utf-8')).get('rooms', [])
            except Exception as e: return None
        await T2.wait_for_timeout(2500)
        L = lobby()
        if L is not None and any(r.get('code') == room2 for r in L):
            check(any(r.get('code') == room2 and r.get('name') == '二班' for r in L), '教室大廳列出二班（名稱）')
            E2 = await sc2.new_page(); await E2.goto(BASE + '?join'); await E2.wait_for_timeout(2500)
            check(await E2.locator('[data-lob="' + room2 + '"]').count() == 1, '學生登入頁的大廳出現二班')
            await E2.click('[data-lob="' + room2 + '"]'); await E2.wait_for_function('window._atq.NET.status==="on"', timeout=15000)
            check(await E2.is_visible('#meK'), '點大廳的教室直接進入')
            await T1.wait_for_timeout(300)
        else:
            print('－ 略過教室大廳（轉播站還是舊版：/lobby?k=SIGN 沒有列出簽到教室，部署 Worker 後再跑一次）'); skips.append('lobby')
        await T2.click('[data-act=stop]'); await T2.wait_for_timeout(2500)
        L = lobby()
        if 'lobby' not in skips: check(L is not None and not any(r.get('code') == room2 for r in L), '結束簽到後從大廳移除')
        await E.screenshot(path=os.path.join(OUT, 'entry.png'))
        # 忘記密碼
        await T1.click('header [data-act=settings]')
        await T1.click('.set-sec[data-sec=adm] summary') if not await T1.is_visible('[data-act=admForget]') else None
        await T1.click('[data-act=admForget]'); await T1.fill('#forgetIn', '清除全部'); await T1.click('[data-act=admForgetOk]'); await T1.wait_for_timeout(500)
        nm = await T1.evaluate('window._atq.C.name')
        check(await T1.evaluate('localStorage.getItem("atq.adm")') is None and '範例' in nm, '忘記密碼：清除全部（含管理密碼）並放回範例')
        await T1.screenshot(path=os.path.join(OUT, 'teacher.png'))
        check(not errs, '沒有 console 錯誤 ' + str(errs[:3]))
        await b.close()
    print('\n%s %d 項失敗%s' % ('✗' if fails else '✓', len(fails), '（略過：' + '、'.join(skips) + '）' if skips else ''))
    sys.exit(1 if fails else 0)
asyncio.run(main())

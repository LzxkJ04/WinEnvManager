# -*- coding: utf-8 -*-
"""CDP 驱动 WinEnv管家 引导壳：完整安装流程"""
import json, urllib.request, websocket, time

targets = json.load(urllib.request.urlopen('http://127.0.0.1:9225/json/list', timeout=5))
ws = websocket.create_connection(targets[0]['webSocketDebuggerUrl'], timeout=60,
                                origin='http://127.0.0.1:9225')
mid = [0]

def ev(expr, wait=0.2):
    mid[0] += 1
    ws.send(json.dumps({'id': mid[0], 'method': 'Runtime.evaluate',
                        'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}}))
    while True:
        resp = json.loads(ws.recv())
        if resp.get('id') == mid[0]:
            r = resp.get('result', {})
            if 'exceptionDetails' in r:
                return 'EXC: ' + json.dumps(r['exceptionDetails'])[:200]
            time.sleep(wait)
            return r.get('result', {}).get('value')

def active():
    return ev("(function(){var a=document.querySelector('.page.active');return a?a.id:'-';})()")

def click_next():
    prev = ev("(function(){var a=document.querySelector('.page.active');return a?a.id:'-';})()")
    ev("document.getElementById('btnNext').click()", 0.4)
    for i in range(20):
        time.sleep(0.15)
        curr = ev("(function(){var a=document.querySelector('.page.active');return a?a.id:'-';})()")
        if curr != prev: return curr
    return curr

print('初始页:', active())
print('sys_info:', ev("invoke('sys_info').then(s=>JSON.stringify({build:s.winBuild,admin:s.isAdmin,wv2:s.webview2,ver:s.installedVersion}))", 0.8))

# 页1 欢迎 → 检测
click_next()
time.sleep(2)
print('第2页:', active())
print('检测状态:', ev("JSON.stringify([...document.querySelectorAll('#chkList .chk .rs')].map(e=>e.textContent))"))
print('下一步可用:', ev("!document.getElementById('btnNext').disabled"))

# 检测 → 许可
click_next(); time.sleep(0.5)
print('第3页:', active())
# 勾选同意
ev("document.getElementById('optAgree').click()")
click_next(); time.sleep(0.5)
print('第4页:', active())
click_next(); time.sleep(0.5)
print('第5页(组件):', active())
click_next(); time.sleep(0.5)
print('第6页(路径):', active())
print('路径值:', ev("JSON.stringify([inApp.value, inData.value])"))
print('路径校验:', ev("JSON.stringify(validatePaths(false))"))
click_next(); time.sleep(0.5)
print('第7页(高级):', active())
click_next(); time.sleep(0.5)
print('第8页(汇总):', active())
print('汇总内容:', ev("document.getElementById('sumBox').innerText.replace(/\\n/g,' | ').slice(0,200)"))
# 安装！
click_next(); time.sleep(1)
print('第9页(进度):', active())
print('进度:', ev("progPct.textContent + ' ' + progStat.textContent"))
# 轮询等待完成
for i in range(120):
    time.sleep(2)
    phase = ev("lastPhase")
    pct = ev("progPct.textContent")
    stat = ev("progStat.textContent")
    print(f'  [{i*2}s] phase={phase} {pct} {stat}')
    if phase in ('done', 'failed'):
        break
time.sleep(2)
print('最终页:', active())
print('安装验证: 主程序', ev("invoke('sys_info').then(s=>JSON.stringify({ver:s.installedVersion,path:s.installedPath}))", 0.8))

# 完成页 → 完成按钮（不勾启动，避免拉起主程序）
ev("document.getElementById('cbRun').classList.remove('sel')")
ev("finish()")
time.sleep(1.5)
ws.close()
print('驱动结束')

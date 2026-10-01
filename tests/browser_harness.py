"""Render and interact with the actual UI through a local HTTP bridge.
The managed browser in this build environment cannot navigate to local URLs.
This adapter keeps production HTML/CSS/JS unchanged and forwards API calls to
our running Node process. SSE-specific behavior is tested separately in Node.
"""
import json,re,urllib.request,urllib.error,os,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE_URL=os.environ.get('NETSCOPE_URL','http://127.0.0.1:3000').rstrip('/')
BROWSER=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')

def request(path,options=None):
    options=options or {}
    req=urllib.request.Request(BASE_URL+path,data=(options.get('body','').encode() if options.get('method')=='POST' else None),headers=options.get('headers',{}),method=options.get('method','GET'))
    try:
        with urllib.request.urlopen(req,timeout=60) as r: return {'status':r.status,'body':r.read().decode()}
    except urllib.error.HTTPError as e: return {'status':e.code,'body':e.read().decode()}

BRIDGE='''
window.fetch = async (url, options={}) => {
  const response=await window.__local_http(String(url),options);
  return {ok:response.status>=200 && response.status<300,status:response.status,json:async()=>JSON.parse(response.body),text:async()=>response.body};
};
window.EventSource=class {
  constructor(){
    this.handlers={}; this.last=-1;this.generation=-1;
    this.timer=setInterval(async()=>{
      try{
        const response=await window.__local_http('/api/state',{});const state=JSON.parse(response.body);
        if(this.generation!==state.generation){this.last=-1;this.generation=state.generation;}
        for(const e of state.events){if(e.id>this.last){(this.handlers.network||[]).forEach(h=>h({data:JSON.stringify(e)}));this.last=e.id;}}
        (this.handlers.state||[]).forEach(h=>h({data:JSON.stringify(state)}));
      }catch(e){if(this.onerror)this.onerror(e);}
    },120);
    setTimeout(()=>this.onopen&&this.onopen(),50);
  }
  addEventListener(name,handler){(this.handlers[name]??=[]).push(handler);}
  close(){clearInterval(this.timer);}
};
'''

def setup(browser,width=1600,height=1100):
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
    page.expose_function('__local_http',request)
    html=(ROOT/'public/index.html').read_text()
    html=re.sub(r'<link[^>]*>','',html)
    html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S)
    page.set_content(html,wait_until='domcontentloaded')
    page.add_style_tag(content=(ROOT/'public/styles.css').read_text())
    page.add_script_tag(content=BRIDGE)
    page.add_script_tag(content=(ROOT/'public/app.js').read_text())
    page.wait_for_selector('.svg-node')
    return page

if __name__=='__main__':
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=BROWSER,args=['--no-sandbox'])
    page=setup(browser)
    page.screenshot(path=str(ROOT/'evidence/ui-initial.png'),full_page=True)
    print(page.title(),page.locator('.svg-node').count(),page.locator('#global-error').is_visible())
    browser.close()

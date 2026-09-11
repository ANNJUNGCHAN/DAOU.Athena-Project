import json,urllib.request,sys
def rpc(m,p):
 req=urllib.request.Request('http://127.0.0.1:29979/mcp',data=json.dumps({'jsonrpc':'2.0','id':1,'method':m,'params':p}).encode(),headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
 with urllib.request.urlopen(req,timeout=45) as r:t=r.read().decode()
 return json.loads(next((x[6:] for x in t.splitlines() if x.startswith('data: ')),t))
if __name__ == '__main__':
 a=json.loads(sys.argv[1])
 r=rpc('tools/call',a)
 print(json.dumps(r,ensure_ascii=True))

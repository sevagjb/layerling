import re,sys,os,collections
REPO=sys.argv[1]; EN=REPO+"/docs/guide/en"; AR=REPO+"/docs/guide/ar"
pats={'ui':r'\{\{ui:[^}]+\}\}','value':r'\{\{value:[^}]+\}\}','shortcuts':r'\{\{shortcuts\}\}',
 'shot':r'\(shot:[^)]+\)','chapter':r'\(chapter:[^)]+\)','anchor':r'\(#[^)]+\)','url':r'https?://[^\s)\]]+',
 'code':r'`[^`]+`','key':r'\[\[[^\]]+\]\]','h2':r'(?m)^## ','h3':r'(?m)^### ','li':r'(?m)^- ','ol':r'(?m)^\d+\. ','row':r'(?m)^\|','quote':r'(?m)^> '}
def slug(t):
    t=t.lower(); t=re.sub(r'<[^>]*>','',t); t=re.sub(r'[^a-z0-9]+','-',t); return t.strip('-')
need=collections.defaultdict(set)
for f in sorted(os.listdir(EN)):
    for m in re.finditer(r'\((?:chapter:([a-z0-9-]+))?#([a-z0-9-]+)\)',open(f"{EN}/{f}").read()):
        need[m.group(1) or f[3:-3]].add(m.group(2))
gl=open(REPO+'/apps/web/src/lib/guideLinks.ts').read()
chap={k:v for k,v in re.findall(r'(\w+): \{ de: "[^"]+", en: "([^"]+)"',gl)}
for k,c,a in re.findall(r'(\w+): \{ chapter: "(\w+)", de: "[^"]+", en: "([^"]+)"',gl):
    need[chap[c]].add(a)
bad=0
for f in sorted(os.listdir(EN)):
    e=open(f"{EN}/{f}").read(); p=f"{AR}/{f}"
    if not os.path.exists(p): print("MISSING",f); bad+=1; continue
    a=open(p).read()
    for n,r in pats.items():
        ce,ca=collections.Counter(re.findall(r,e)),collections.Counter(re.findall(r,a))
        if n in('code',): # code: compare sets ignoring backtick count of placeholders
            pass
        if ce!=ca:
            bad+=1; print(f,n,"EN-only:",dict(ce-ca),"AR-only:",dict(ca-ce))
    ids={slug(h) for h in re.findall(r'(?m)^#{2,3} (.*)$',a)}
    ids|={slug(x) for h in re.findall(r'(?m)^#{2,3} (.*)$',a) for x in re.findall(r'\(([^()]*)\)\s*$',h)}
    for anc in need.get(f[3:-3],()):
        if anc not in ids: bad+=1; print(f,"ANCHOR missing:",anc)
    if not a.startswith('---\ntitle: '): bad+=1; print(f,"frontmatter")
print("problems:",bad)

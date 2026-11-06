#!/usr/bin/env python3
"""Builds seed/localities.json and seed/merged-cities.json from GeoNames data (CC BY 4.0).

Download cities15000.zip, admin1CodesASCII.txt and countryInfo.txt from
https://download.geonames.org/export/dump/ into one folder, unzip cities15000.txt
into an `x` subfolder, then run:

    python3 -I scripts/gen-cities.py <folder> seed/localities.json

Campuses and metro areas are defined below. After changing them, run seed:sql and
apply seed/seed.sql, which also moves anyone in a merged place to its metro area.
"""
import csv,json,re,sys,unicodedata
D,out=sys.argv[1],sys.argv[2]
csv.field_size_limit(10**7)
adm={l.split('\t')[0]:l.split('\t')[1] for l in open(f'{D}/admin1CodesASCII.txt',encoding='utf8')}
country={}
for l in open(f'{D}/countryInfo.txt',encoding='utf8'):
    if l.startswith('#'): continue
    p=l.rstrip('\n').split('\t'); country[p[0]]=p[4]
SHORT={'United States':'United States','United Kingdom':'United Kingdom'}
WORLD_MIN=300_000; CANADA_MIN=30_000
EXISTING={('Boston','US'):'boston',('New York City','US'):'new-york',('San Francisco','US'):'san-francisco',('London','GB'):'london',('Toronto','CA'):'toronto'}
RENAME={'new-york':'New York','san-francisco':'San Francisco Bay Area'}
# Matching is by exact city, so a metro area's suburbs share its row instead of splitting its people up.
METRO={'Toronto':['Mississauga','Brampton','Markham','Vaughan','Richmond Hill','Oakville','Ajax','Pickering','Milton','Aurora','Newmarket','Scarborough','Etobicoke','North York','Whitby','Oshawa'],
'Montréal':['Laval','Longueuil','Brossard','Terrebonne','Repentigny','Blainville','Saint-Jean-sur-Richelieu','Dollard-des-Ormeaux'],
'Vancouver':['Surrey','Burnaby','Richmond','Coquitlam','Langley','Delta','North Vancouver','New Westminster','Port Coquitlam','Maple Ridge','West Vancouver','White Rock'],
'Ottawa':['Gatineau','Aylmer','Kanata','Nepean','Orléans','Hull','Gloucester','Stittsville'],
'Waterloo':['Kitchener','Cambridge'],
'Calgary':['Airdrie'],
'Edmonton':['St. Albert','Sherwood Park','Spruce Grove'],
'Hamilton':['Burlington','Ancaster'],
'Québec':['Lévis'],
'St. Catharines':['Niagara Falls','Welland','Thorold'],
'Victoria':['Saanich','Langford'],
'Halifax':['Dartmouth'],
'Saint John':['Quispamsis'],
'Moncton':['Dieppe']}
def fold(s): return unicodedata.normalize('NFD',s).encode('ascii','ignore').decode().lower()
absorbed={fold(a) for v in METRO.values() for a in v}
rows=list(csv.reader(open(f'{D}/x/cities15000.txt',encoding='utf8'),delimiter='\t',quoting=csv.QUOTE_NONE))
pop_of={}
cities=[];seen=set();ca_found=set();hand_merged={}
for r in rows:
    name,ascii_,fcode,cc,a1,pop=r[1],r[2],r[7],r[8],r[10],int(r[14] or 0)
    if fcode in('PPLX','PPLH','PPLQ','PPLW'): continue
    if cc=='CA': pop_of[fold(name)]=max(pop_of.get(fold(name),0),pop)
    if pop<(CANADA_MIN if cc=='CA' else WORLD_MIN): continue
    slug=re.sub(r'[^a-z0-9]+','-',fold(name)).strip('-')
    if cc=='CA' and fold(name) in absorbed:
        hand_merged[f"{slug}-{a1.lower()}-{cc.lower()}"]=next(k for k,v in METRO.items() if fold(name) in {fold(x) for x in v})
        continue
    cid=EXISTING.get((ascii_,cc)) or EXISTING.get((name,cc)) or f"{slug}-{a1.lower()}-{cc.lower()}"
    if cid in seen: continue
    seen.add(cid)
    c=dict(id=cid,name=RENAME.get(cid,name),kind='city',parentId=None,region=adm.get(f'{cc}.{a1}',''),country=country.get(cc,cc),countryCode=cc,population=pop,aliases=[],latitude=round(float(r[4]),3),longitude=round(float(r[5]),3))
    if cc=='CA' and name in METRO: c['aliases']=METRO[name]; ca_found.add(name)
    cities.append(c)
missing=set(METRO)-ca_found
assert not missing, missing
for c in cities:
    if c['countryCode']=='CA' and c['aliases']:
        c['population']=max([c['population']]+[pop_of.get(fold(a),0) for a in c['aliases']])
# Matching uses the exact city, so anything inside a metro area must share its row.
# Canada uses a radius per metro. Elsewhere, a much bigger neighbour in the same country absorbs it.
import math
def km(a,b):
    r=math.pi/180; x=math.sin((b['latitude']-a['latitude'])*r/2)**2+math.cos(a['latitude']*r)*math.cos(b['latitude']*r)*math.sin((b['longitude']-a['longitude'])*r/2)**2
    return 2*6371*math.asin(math.sqrt(x))
CA_RADIUS={'Toronto':45,'Montréal':45,'Vancouver':40,'Ottawa':30,'Calgary':35,'Edmonton':30,'Québec':25,'Winnipeg':20,'Hamilton':20,'Waterloo':15,'London':20,'Halifax':25,'Victoria':20,'St. Catharines':20,'Windsor':15,'Barrie':15,'Abbotsford':15,'Brantford':10,'Kelowna':20,'Saskatoon':20,'Regina':20,'Kingston':15,'Sherbrooke':15,'Gatineau':0}
WORLD_KM=20; WORLD_MAX_POP=1_000_000; WORLD_RATIO=2
cities.sort(key=lambda c:-c['population'])
merged={}
anchors=[c for c in cities if c['countryCode']=='CA' and CA_RADIUS.get(c['name'],0)>0]
for c in cities:
    if c['countryCode']=='CA':
        if c in anchors: continue
        near=[(km(c,a),a) for a in anchors if km(c,a)<=CA_RADIUS[a['name']]]
        if near: merged[c['id']]=min(near,key=lambda t:t[0])[1]['id']
    elif c['id'] not in EXISTING.values() and c['population']<WORLD_MAX_POP:
        near=[(km(c,o),o) for o in cities if o['countryCode']==c['countryCode'] and o['population']>=WORLD_RATIO*c['population'] and km(c,o)<=WORLD_KM]
        if near: merged[c['id']]=min(near,key=lambda t:t[0])[1]['id']
def root(i):
    while i in merged: i=merged[i]
    return i
by_id={c['id']:c for c in cities}
for i in merged:
    t=by_id[root(i)]; n=by_id[i]['name']
    if n not in t['aliases']: t['aliases'].append(n)
merged_final={i:root(i) for i in merged}
for i,metro in hand_merged.items():
    merged_final[i]=root(next(c['id'] for c in cities if c['countryCode']=='CA' and c['name']==metro))
cities=[c for c in cities if c['id'] not in merged]
json.dump(merged_final,open(out.replace('localities.json','merged-cities.json'),'w'),ensure_ascii=False,indent=0,sort_keys=True)
by={(c['name'],c['countryCode'],c['region']):c['id'] for c in cities}
def city(name,region): return by[(name,'CA',region)]
ON,QC,BC,AB='Ontario','Quebec','British Columbia','Alberta'
CAMPUS=[('uOttawa','Ottawa',ON,'uottawa'),('Carleton University','Ottawa',ON,'carleton-university'),
('University of Toronto','Toronto',ON,'u-of-t'),('York University','Toronto',ON,'york-university'),('Toronto Metropolitan University','Toronto',ON,'toronto-metropolitan'),('OCAD University','Toronto',ON,'ocad'),
('McGill University','Montréal',QC,'mcgill'),('Université de Montréal','Montréal',QC,'umontreal'),('Concordia University','Montréal',QC,'concordia'),('UQAM','Montréal',QC,'uqam'),
('UBC','Vancouver',BC,'ubc'),('Simon Fraser University','Vancouver',BC,'sfu'),('University of Victoria','Victoria',BC,'uvic'),
('University of Calgary','Calgary',AB,'ucalgary'),('Mount Royal University','Calgary',AB,'mount-royal'),('University of Alberta','Edmonton',AB,'ualberta'),('MacEwan University','Edmonton',AB,'macewan'),
('University of Waterloo','Waterloo',ON,'uwaterloo'),('Wilfrid Laurier University','Waterloo',ON,'laurier'),('McMaster University','Hamilton',ON,'mcmaster'),("Queen's University",'Kingston',ON,'queens'),('Western University','London',ON,'western'),('University of Guelph','Guelph',ON,'uoguelph'),('Brock University','St. Catharines',ON,'brock'),('Ontario Tech University','Toronto',ON,'ontario-tech'),
('Université Laval','Québec',QC,'ulaval'),('Université de Sherbrooke','Sherbrooke',QC,'usherbrooke'),('Bishop\'s University','Sherbrooke',QC,'bishops'),
('University of Manitoba','Winnipeg','Manitoba','umanitoba'),('University of Saskatchewan','Saskatoon','Saskatchewan','usask'),('University of Regina','Regina','Saskatchewan','uregina'),
('Dalhousie University','Halifax','Nova Scotia','dalhousie'),('Saint Mary\'s University','Halifax','Nova Scotia','smu'),('Memorial University',"St. John's",'Newfoundland and Labrador','memorial')]
CAMPUS_OTHER=[('Harvard','boston','harvard'),('MIT','boston','mit'),('Boston University','boston','boston-university'),('Columbia','new-york','columbia'),('NYU','new-york','nyu'),('Stanford','san-francisco','stanford'),('UC Berkeley','san-francisco','berkeley'),('UCL','london','ucl'),('LSE','london','lse')]
campuses=[dict(id=i,name=n,kind='campus',parentId=city(c,r),region='',country='',countryCode='',population=0,aliases=[],latitude=0,longitude=0) for n,c,r,i in CAMPUS]+[dict(id=i,name=n,kind='campus',parentId=p,region='',country='',countryCode='',population=0,aliases=[],latitude=0,longitude=0) for n,p,i in CAMPUS_OTHER]
assert len({x['id'] for x in cities+campuses})==len(cities+campuses)
print('merged away',len(merged_final),'hand',len(hand_merged))
with open(out,'w',encoding='utf8') as f:
    f.write('[\n'+',\n'.join('  '+json.dumps(x,ensure_ascii=False,separators=(', ',': ')) for x in cities+campuses)+'\n]\n')
ca=[c for c in cities if c['countryCode']=='CA']
print('cities',len(cities),'canada',len(ca),'countries',len({c['countryCode'] for c in cities}),'campuses',len(campuses))
print('top canada:',[f"{c['name']} {c['population']//1000}k" for c in ca[:14]])
print('uottawa parent:',[c['parentId'] for c in campuses if c['id']=='uottawa'])
print('existing ids kept:',[i for i in ('boston','new-york','san-francisco','london','toronto') if i in {c['id'] for c in cities}])
print('sample world:',[f"{c['name']}, {c['country']}" for c in cities[:6]])
print('names with commas/odd:',sum(1 for c in cities if not c['region']))

import base64,hashlib,json,pathlib,sys,time,zlib
root=pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root))
from query_batch import aws,RUNTIME
out=pathlib.Path(__file__).resolve().parent
original=(root/'team_probe.py').read_text()
runner=original[original.index("service=aws("):]
runner=runner.replace("'probe_sha256':hashlib.sha256(probe).hexdigest()", "'probe_sha256':hashlib.sha256(probe).hexdigest(),'selector_sha256':hashlib.sha256(selector).hexdigest()")
runner=runner.replace('range(120)','range(180)').replace("(out/'team-exact.json')","(out/'sample.json')").replace("print('editions/domains',len(result['rows']))","print('sample rows',len(result['sample']), flush=True)")
runner=runner.replace("opt=cn['logConfiguration']['options'];stream=", "opt=cn['logConfiguration']['options'];stream=").replace("if 'AUDIT_END' not in msgs:","(out/'checkpoints.txt').write_text('\\n'.join(s for s in msgs if s.startswith('CHECKPOINT'))+'\\n')\n if 'AUDIT_END' not in msgs:")
selector=(out/'sample.sql').read_bytes()
assert selector.lstrip().upper().startswith(b'WITH') and b';' not in selector
probe=(out/'probe.py').read_bytes()
payload=base64.b64encode(zlib.compress(b'SAMPLE_SQL = '+repr(selector.decode()).encode()+b'\n'+probe,9)).decode()
code=RUNTIME[:RUNTIME.index('queries=')]+RUNTIME[RUNTIME.index('with psycopg.connect'):RUNTIME.index(' for name,q')]+"""
 exec(zlib.decompress(base64.b64decode(PAYLOAD)),globals())
 result=audit(db)
 data=enc(result)
 for i in range(0,len(data),8500): print('ROW',i,data[i:i+8500],flush=True)
 print('AUDIT_END',flush=True)
""".replace('PAYLOAD',repr(payload))
assert not (out/'sample.json').exists()
exec(runner)

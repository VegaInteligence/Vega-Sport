"""Mesurer la présence de l'option de collecte sur ECS sans lire de valeur de clé."""
import datetime,json,subprocess
from pathlib import Path
p=Path(__file__).resolve().parent
def aws(*args):
    return json.loads(subprocess.check_output(['aws','--profile','statarena','--region','us-east-2','ecs',*args,'--output','json','--no-cli-pager']))
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'region':'us-east-2','services':[]}
for service in ('vega-v2-worker','vega-v2-backfill'):
    desc=aws('describe-services','--cluster','vega-v2','--services',service,'--query','services[].{service:serviceName,definition:taskDefinition,desired:desiredCount,running:runningCount}')
    assert len(desc)==1,service
    info=desc[0]
    d=aws('describe-task-definition','--task-definition',info['definition'],'--query','taskDefinition.containerDefinitions[].{name:name,secretRef:contains(not_null(secrets[].name, `[]`), `V2_ODDS_API_KEY`),env:contains(not_null(environment[].name, `[]`), `V2_ODDS_API_KEY`),envFileCount:length(not_null(environmentFiles, `[]`))}')
    ids=aws('list-tasks','--cluster','vega-v2','--service-name',service,'--desired-status','RUNNING','--query','taskArns')
    overrides=aws('describe-tasks','--cluster','vega-v2','--tasks',*ids,'--query','tasks[].{status:lastStatus,override:overrides.containerOverrides[].{name:name,keyName:contains(not_null(environment[].name, `[]`), `V2_ODDS_API_KEY`),overrideEnvFileCount:length(not_null(environmentFiles, `[]`))}}') if ids else []
    out['services'].append({'service':service,'definition':info['definition'].rsplit('/',1)[-1],'desired':info['desired'],'running':info['running'],'containers':d,'runningOverrides':overrides})
(p/'resultat.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out))

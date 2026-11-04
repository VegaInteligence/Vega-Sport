const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { appendFileSync } = require('node:fs');
const { BlockList, isIPv4 } = require('node:net');

const group = 'sg-0667c20e8ff5d2431';
const account = '361769570630';
const region = 'us-east-2';
const exceptions = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) exceptions.addSubnet(network, bits);

function ec2(command, ...args) {
  return JSON.parse(execFileSync('aws', [
    'ec2', command, '--region', region, '--output', 'json', '--no-cli-pager', ...args,
  ], { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] }));
}

function checkGroup() {
  const { SecurityGroups } = ec2('describe-security-groups', '--group-ids', group);
  if (SecurityGroups?.length !== 1 || SecurityGroups[0].GroupId !== group || SecurityGroups[0].OwnerId !== account) {
    throw Error('Unexpected RDS security group or owner; refusing network change.');
  }
}

function rules() {
  return ec2('describe-security-group-rules', '--filters', 'Name=group-id,Values=' + group).SecurityGroupRules;
}

function isOwned(rule, cidr, owner) {
  return rule.GroupId === group && rule.GroupOwnerId === account && rule.IsEgress === false &&
    rule.IpProtocol === 'tcp' && Number(rule.FromPort) === 5432 && Number(rule.ToPort) === 5432 &&
    rule.CidrIpv4 === cidr && rule.Description === owner &&
    rule.Tags?.some(tag => tag.Key === 'ManagedBy' && tag.Value === 'statarena-actions') &&
    /^sgr-[0-9a-f]+$/.test(rule.SecurityGroupRuleId);
}

function save(key, value) {
  appendFileSync(process.env.GITHUB_STATE, key + '=' + value + '\n');
}

function marker() {
  const { GITHUB_REPOSITORY_ID: repo, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt, GITHUB_JOB: job } = process.env;
  if (repo !== '1441213700' || !/^\d+$/.test(run) || !/^\d+$/.test(attempt) || !/^[a-z0-9_-]{1,80}$/i.test(job)) {
    throw Error('Unexpected GitHub job identity.');
  }
  return `statarena-gh-${repo}-${run}-${attempt}-${job}-${randomUUID()}`;
}

async function open() {
  const owner = marker();
  const res = await fetch('https://checkip.amazonaws.com/', { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw Error('Could not discover runner IPv4.');
  const ip = (await res.text()).trim();
  if (!isIPv4(ip) || exceptions.check(ip)) throw Error('Runner address must be one public IPv4.');
  const cidr = ip + '/32';
  checkGroup();
  // Save recovery data before creation in case AWS accepts the request and the response is lost.
  save('owner', owner);
  save('cidr', cidr);
  const permission = [{ IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432, IpRanges: [{ CidrIp: cidr, Description: owner }] }];
  const tags = [{ ResourceType: 'security-group-rule', Tags: [{ Key: 'ManagedBy', Value: 'statarena-actions' }] }];
  let created;
  try {
    created = ec2('authorize-security-group-ingress', '--group-id', group,
      '--ip-permissions', JSON.stringify(permission), '--tag-specifications', JSON.stringify(tags)).SecurityGroupRules;
  } catch (error) {
    if (!String(error.stderr).includes('InvalidPermission.Duplicate')) throw error;
    created = rules().filter(rule => isOwned(rule, cidr, owner));
  }
  if (created?.length !== 1 || !isOwned(created[0], cidr, owner)) throw Error('Could not establish ownership of a runner rule.');
  save('rule_id', created[0].SecurityGroupRuleId);
  console.log('Temporary TCP/5432 runner rule installed:', created[0].SecurityGroupRuleId);
}

function close() {
  const { STATE_owner: owner, STATE_cidr: cidr, STATE_rule_id: id } = process.env;
  if (!owner || !cidr) return;
  checkGroup();
  const candidates = rules();
  const rule = id ? candidates.find(r => r.SecurityGroupRuleId === id) : candidates.find(r => isOwned(r, cidr, owner));
  if (!rule) return;
  if (!isOwned(rule, cidr, owner)) throw Error('Runner rule changed ownership or scope. Existing rule preserved.');
  ec2('revoke-security-group-ingress', '--group-id', group, '--security-group-rule-ids', rule.SecurityGroupRuleId);
  console.log('Removed runner rule:', rule.SecurityGroupRuleId);
}

async function run(mode) {
  if (mode === 'close') return close();
  if (mode !== 'open') throw Error('Unknown runner network action');
  return open();
}
module.exports = { run };
if (require.main === module) run(process.argv[2] || 'open').catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

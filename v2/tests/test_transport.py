import json, unittest
from vega_v2.pitchapi import PitchClient, PitchError

class TransportTest(unittest.TestCase):
 def test_valid_empty_and_unavailable_and_bad_id(self):
  results=iter([(200,{},b'{"data":{"periods":[]}}'),(404,{},b'{"error":{"code":"ANALYTICS_UNAVAILABLE","message":"secret"}}'),(404,{},b'{"error":{"code":"RESOURCE_NOT_FOUND"}}')])
  c=PitchClient('pk_test_dummy',interval=0,transport=lambda *args:next(results),sleep=lambda x:None)
  self.assertEqual(c.fetch('/matches/m_123456/shots').data,{'periods':[]})
  self.assertEqual(c.fetch('/matches/m_123456/advanced').coverage,'unavailable')
  with self.assertRaisesRegex(PitchError,'RESOURCE_NOT_FOUND'): c.fetch('/matches/m_123456')
 def test_block_unknown_paths_and_heatmap_frame(self):
  c=PitchClient('pk_test_dummy',interval=0,transport=lambda req,t:(200,{},b'{"data":[]}'),sleep=lambda x:None)
  with self.assertRaises(PitchError): c.fetch('/matches/m_123456/players/p_123456')
  with self.assertRaises(PitchError): c.fetch('/matches/m_123456/heatmaps',{'frame':'home_ltr'})
 def test_retry_429_and_secret_absent_error(self):
  delays=[];records=iter([(429,{'Retry-After':'2'},b'{"error":{"code":"RATE_LIMIT_EXCEEDED"}}'),(200,{},b'{"data":[]}')]);c=PitchClient('pk_test_secret',interval=0,transport=lambda *x:next(records),sleep=delays.append)
  self.assertEqual(c.fetch('/leagues').data,[]);self.assertIn(2,delays)
  c=PitchClient('pk_test_secret',interval=0,transport=lambda *x:(500,{},b'{"error":{"code":"pk_test_secret"}}'),sleep=lambda x:None,retries=0)
  with self.assertRaises(PitchError) as e:c.fetch('/leagues')
  self.assertNotIn('pk_test_secret',str(e.exception))
 def test_observer_reports_only_bounded_metadata_each_attempt(self):
  calls=[]; responses=iter([(429,{'X-Request-ID':'req_123'},b'{"error":{"code":"RATE_LIMIT_EXCEEDED","message":"secret"}}'),(200,{},b'{"data":[]}')]); c=PitchClient('pk_test_secret',interval=0,transport=lambda *x:next(responses),sleep=lambda _:None,on_attempt=calls.append)
  c.fetch('/leagues');self.assertEqual(len(calls),2);self.assertEqual(calls[0]['error_code'],'RATE_LIMIT_EXCEEDED');self.assertIsNone(calls[1]['error_code']);self.assertEqual(set(calls[0]),{'status','error_code','duration_ms','fetched_at','request_id'});self.assertNotIn('secret',str(calls))
 def test_observer_transport_error(self):
  calls=[]
  def bad(*a):raise OSError('secret')
  c=PitchClient('pk_test_secret',interval=0,transport=bad,on_attempt=calls.append)
  with self.assertRaises(PitchError):c.fetch('/leagues')
  self.assertEqual(calls[0]['error_code'],'TRANSPORT_ERROR');self.assertNotIn('secret',str(calls))
 def test_null_error_success_and_sanitized_shape(self):
  c=PitchClient('pk_test_secret',interval=0,transport=lambda *x:(200,{},b'{"data":{"leagues":[]},"error":null}'),sleep=lambda x:None)
  self.assertEqual(c.fetch('/leagues').data,{'leagues':[]})
  for payload,shape in [(b'[]','root_array'),(b'{"secret":"payload"}','object_neither'),(b'{"data":[],"error":{"code":"x"}}','object_both')]:
   c=PitchClient('pk_test_secret',interval=0,transport=lambda *x:(200,{},payload),sleep=lambda x:None)
   with self.assertRaises(PitchError) as caught:c.fetch('/leagues')
   self.assertEqual(caught.exception.status,200);self.assertEqual(caught.exception.envelope_shape,shape);self.assertNotIn('payload',str(caught.exception))

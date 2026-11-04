import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import sandbox_scan as worker

class SandboxTests(unittest.TestCase):
 def setUp(self):
  self.id='00000000-0000-4000-8000-000000000001'
  self.job={'id':self.id,'expected_bytes':123,'url':'https://'+'a'*32+'.r2.cloudflarestorage.com/an-ipa-quarantine/quarantine/'+self.id+'.ipa?X-Amz-Signature=synthetic'}
 def test_rejects_arbitrary_urls_and_size(self):
  for url in ['http://example.com/file','https://example.com/file','file:///etc/passwd','https://'+'a'*32+'.r2.cloudflarestorage.com/other/file']:
   with self.assertRaises(worker.WorkerError):worker.validate_job({**self.job,'url':url})
  with self.assertRaises(worker.WorkerError):worker.validate_job({**self.job,'expected_bytes':True})
 def test_invalid_archive_is_rejected_without_secret_output(self):
  class Body(io.BytesIO):
   headers={'Content-Length':'123'}
  with mock.patch.object(worker,'secure_opener') as opener:
   opener.return_value.open.return_value=Body(b'A'*123)
   report=worker.scan(self.job)
  self.assertEqual(report['state'],'rejected')
  self.assertNotIn('X-Amz',json.dumps(report))
 def test_missing_content_length_rejected(self):
  class Body(io.BytesIO):headers={}
  with mock.patch.object(worker,'secure_opener') as opener:
   opener.return_value.open.return_value=Body(b'A'*123)
   self.assertEqual(worker.scan(self.job)['error'],'OBJECT_LENGTH_MISMATCH')
 def test_isolated_entrypoint_can_import_local_modules(self):
  directory=str(Path(__file__).resolve().parents[1])
  # Mirrors Docker's fixed trusted import path; no untrusted path is evaluated.
  result=subprocess.run([sys.executable,'-I','-c',f"import sys; sys.path.insert(0,{directory!r}); from quarantine_worker import main; raise SystemExit(main())"],env={**os.environ,'IPA_QUARANTINE_WORKER_ENABLED':'false'},capture_output=True,text=True,timeout=5)
  self.assertEqual(result.returncode,0,result.stderr)
  self.assertEqual(json.loads(result.stdout)['status'],'disabled')

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""Unprivileged Vercel Sandbox entrypoint. Takes ONE expiring R2 GET grant.

No Supabase secret, R2 access key, signing key, P12 or UDID leaves this process.
Metadata output cannot authorize installation. No archive extraction/execution.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import signal
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
from ipa_inspector import inspect_ipa, InspectionError
from quarantine_worker import sanitized_report, WorkerError, secure_opener

MAX_BYTES = 100 * 1024 * 1024

def limits():
    # Hard limits cover malicious archive parsing and OpenSSL child processes.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_BYTES + 1048576, MAX_BYTES + 1048576))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CPU, (90, 95))
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(WorkerError('SCAN_DEADLINE', True)))
    signal.alarm(180)


def validate_job(job):
    if not isinstance(job, dict) or type(job.get('expected_bytes')) is not int or not 100 <= job['expected_bytes'] <= MAX_BYTES:
        raise WorkerError('INVALID_JOB')
    if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', str(job.get('id', ''))):
        raise WorkerError('INVALID_JOB')
    url = urllib.parse.urlsplit(str(job.get('url', '')))
    if (url.scheme != 'https' or not url.hostname or not re.fullmatch(r'[a-f0-9]{32}\.r2\.cloudflarestorage\.com', url.hostname)
        or url.username or url.password or url.port or url.fragment
        or not re.fullmatch(r'/[a-z0-9-]{3,63}/quarantine/' + job['id'] + r'\.ipa', url.path)):
        raise WorkerError('INVALID_DOWNLOAD_ORIGIN')
    # URL is a server-issued, object-scoped grant, never an arbitrary client URL.
    if len(job['url']) > 4096:
        raise WorkerError('INVALID_JOB')
    return job


def scan(job):
    job = validate_job(job)
    digest = hashlib.sha256()
    size = 0
    deadline = time.monotonic() + 120
    try:
        with tempfile.TemporaryDirectory(prefix='an-ipa-') as temp:
            path = Path(temp) / 'quarantine.ipa'
            with secure_opener().open(job['url'], timeout=20) as stream, path.open('xb') as output:
                header = stream.headers.get('Content-Length')
                if header is None or not header.isdigit() or int(header) != job['expected_bytes']:
                    raise WorkerError('OBJECT_LENGTH_MISMATCH')
                while True:
                    if time.monotonic() > deadline:
                        raise WorkerError('DOWNLOAD_DEADLINE', True)
                    block = stream.read(65536)
                    if not block:
                        break
                    size += len(block)
                    if size > job['expected_bytes'] or size > MAX_BYTES:
                        raise WorkerError('OBJECT_TOO_LARGE')
                    digest.update(block)
                    output.write(block)
            if size != job['expected_bytes']:
                raise WorkerError('OBJECT_LENGTH_MISMATCH')
            metadata = inspect_ipa(path)
            sha = digest.hexdigest()
            if metadata['ipa_sha256'] != sha or metadata['ipa_size_bytes'] != size:
                raise WorkerError('CONTENT_DIGEST_MISMATCH')
            return {'state':'quarantined_unverified','sha256':sha,'report':sanitized_report(metadata),'error':None}
    except urllib.error.HTTPError as e:
        return {'state':'retry' if e.code in (404,408,429,500,502,503,504) else 'rejected','error':'R2_DOWNLOAD_FAILED'}
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return {'state':'retry','error':'R2_DOWNLOAD_UNAVAILABLE'}
    except InspectionError as e:
        return {'state':'rejected','error': e.code if re.fullmatch(r'[A-Z0-9_]{3,60}',e.code) else 'INSPECTION_REJECTED'}
    except WorkerError as e:
        return {'state':'retry' if e.transient else 'rejected','error':e.code}


def main():
    limits()
    try:
        raw = Path('/vercel/sandbox/job.json').read_bytes()
        if len(raw) > 8192:
            raise WorkerError('INVALID_JOB')
        result = scan(json.loads(raw))
    except Exception:
        result = {'state':'rejected','error':'SANDBOX_SCAN_FAILED'}
    # Result always redacts URL, object key, file name, UDID and certificate bytes.
    print(json.dumps(result))
    signal.alarm(0)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

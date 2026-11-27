"""D4557: synthetic image acceptance, run mounted read-only; never included in the runtime."""
import base64
import errno
import hashlib
import http.client
import io
import json
import multiprocessing
import os
import socket
import stat
import time
import unittest
import zipfile
from unittest.mock import patch
import runner
import server


def request(name='values.json', data=b'[1,2,3]', workload='python', operation='sum'):
    return {'workload': workload, 'operation': operation, 'inputs': [{'name': name, 'data': base64.b64encode(data).decode()}]}


def artifact(data=b'{}'):
    return {'name': 'result.json', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'data': base64.b64encode(data).decode()}


def archive(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as book:
        for name, data in entries:
            book.writestr(name, data)
    return stream.getvalue()


class RunnerAcceptance(unittest.TestCase):
    def answer(self, value):
        result = runner.run_job(value)
        self.assertEqual(result['outcome'], 'succeeded', result)
        self.assertEqual(result['exit_code'], 0)
        output = result['artifacts'][0]
        raw = base64.b64decode(output['data'])
        self.assertEqual(output['bytes'], len(raw))
        self.assertEqual(output['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertGreater(result['peak_rss_bytes'], 0)
        return json.loads(raw)

    def test_approved_calculations_and_formats(self):
        self.assertEqual(self.answer(request()), {'sum': 6.0})
        self.assertEqual(self.answer(request('table.csv', b'1,2\n3,word', 'spreadsheet', 'count')), {'count': 3})
        xlsx = archive([
            ('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
            ('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Values" sheetId="1" r:id="rId1"/></sheets></workbook>'),
            ('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
            ('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="n"><v>2</v></c><c r="B1" t="n"><v>4</v></c></row></sheetData></worksheet>'),
        ])
        self.assertEqual(self.answer(request('table.xlsx', xlsx, 'spreadsheet')), {'sum': 6.0})
        from pypdf import PdfWriter
        pdf = PdfWriter(); pdf.add_blank_page(width=100, height=100); stream = io.BytesIO(); pdf.write(stream)
        self.assertEqual(self.answer(request('blank.pdf', stream.getvalue(), 'document_convert', 'extract')), {'blank.pdf': ['']})
        for suffix, member, xml, expected in [('docx', 'word/document.xml', '<doc><p><t>Hello</t></p></doc>', ['Hello']),
                                               ('pptx', 'ppt/slides/slide1.xml', '<slide><t>Hello</t></slide>', [['Hello']])]:
            raw = archive([('[Content_Types].xml', '<types/>'), (member, xml)])
            self.assertEqual(self.answer(request('sample.' + suffix, raw, 'document_convert', 'extract')), {'sample.' + suffix: expected})

    def test_names_operations_encoding_and_aggregate_size(self):
        cases = [request('a..b.json'), request('../bad.json'), request('code.py'), {**request(), 'operation': 'shell'},
                 {**request(), 'code': 'untrusted'}, {**request(), 'inputs': [{'name': 'v.json', 'data': '!'}]}]
        for value in cases:
            self.assertNotEqual(runner.run_job(value)['outcome'], 'succeeded')
        with patch.object(runner, 'INPUT_CAP', 10):
            value = request(); value['inputs'] *= 2; value['inputs'][1] = {'name': 'other.json', 'data': value['inputs'][0]['data']}
            with self.assertRaisesRegex(runner.Refused, 'input_size'):
                runner.decode_request(value)

    def test_archive_paths_duplicates_symlinks_and_compression(self):
        for entry in ['../escape', '/absolute', 'a\\b', 'a/./b']:
            with self.assertRaisesRegex(runner.Refused, 'archive_path'):
                runner.check_office(archive([('[Content_Types].xml', '<types/>'), (entry, 'x')]))
        with self.assertWarns(UserWarning):
            duplicate = archive([('[Content_Types].xml', '<types/>'), ('duplicate', '1'), ('duplicate', '2')])
        with self.assertRaisesRegex(runner.Refused, 'archive_path'):
            runner.check_office(duplicate)
        symlink = zipfile.ZipInfo('link'); symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaisesRegex(runner.Refused, 'archive_path'):
            runner.check_office(archive([('[Content_Types].xml', '<types/>'), (symlink, 'target')]))

    def test_archive_expansion_entry_count_and_xml_entities(self):
        with self.assertRaisesRegex(runner.Refused, 'archive_expansion'):
            runner.check_office(archive([('[Content_Types].xml', '<types/>'), ('bomb', 'x' * 100000)]))
        with patch.object(runner, 'ENTRY_CAP', 1):
            with self.assertRaisesRegex(runner.Refused, 'archive_entries'):
                runner.check_office(archive([('[Content_Types].xml', '<types/>'), ('extra', 'x')]))
        # Place declaration across the 64-KiB reader boundary, including UTF-16 NUL bytes.
        for data in [b' ' * 65533 + b'<!DOCTYPE x>', (' ' * 32765 + '<!ENTITY x "value">').encode('utf-16-le')]:
            # Stored entries avoid triggering the independent compression-ratio guard first.
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as book:
                book.writestr('[Content_Types].xml', '<types/>'); book.writestr('word/document.xml', data)
            with self.assertRaisesRegex(runner.Refused, 'xml_entities'):
                runner.check_office(stream.getvalue())
            hidden = archive([('[Content_Types].xml', '<types/>'), ('custom-part.data', '<!DOCTYPE x><part/>')])
            with self.assertRaisesRegex(runner.Refused, 'xml_entities'):
                runner.check_office(hidden)

    def test_output_and_document_depth_caps(self):
        with patch.dict(runner.LIMITS, python=(60, 120, 512, 2)):
            with self.assertRaisesRegex(runner.Refused, 'output_limit'):
                runner.execute(request())
        nested = 1
        for _ in range(34): nested = [nested]
        with self.assertRaisesRegex(runner.Refused, 'document_depth'):
            runner.numbers(nested)
        with self.assertRaisesRegex(runner.Refused, 'number_invalid'):
            runner.numbers(float('inf'))

    def test_parser_cannot_create_sockets_processes_or_files(self):
        def probes(_):
            attempts = [socket.socket, os.fork, lambda: os.open('/tmp/compute-write', os.O_WRONLY | os.O_CREAT, 0o600),
                        lambda: os.mkdir('/tmp/compute-dir'), lambda: os.execve('/missing', ['/missing'], {})]
            for action in attempts:
                try: action()
                except OSError as error:
                    if error.errno != errno.EPERM: raise AssertionError('fence did not intercept syscall')
                else: raise AssertionError('forbidden syscall succeeded')
            return artifact()
        with patch.object(runner, 'execute', probes):
            self.assertEqual(self.answer(request()), {})

    def test_cpu_wall_and_memory_hard_termination(self):
        def busy(_):
            while True: pass
        def blocked(_):
            read_fd, write_fd = os.pipe()
            os.read(read_fd, 1)
            return artifact()
        def memory(_):
            retained = bytearray(256 * runner.MIB)
            return artifact(bytes(retained[:1]))
        for operation, limits, expected in [(busy, (1, 5, 128, 100), 'failed'), (blocked, (2, 1, 128, 100), 'timed_out'), (memory, (2, 5, 128, 100), 'failed')]:
            with patch.object(runner, 'execute', operation), patch.dict(runner.LIMITS, python=limits):
                result = runner.run_job(request())
                self.assertEqual(result['outcome'], expected, result)
                self.assertEqual(result['artifacts'], [])
                self.assertLess(result['wall_ms'], 6000)
        self.assertEqual(multiprocessing.active_children(), [])

    def test_independent_xml_parser_refuses_dtd_without_the_package_preflight(self):
        for suffix, member, data in [
            ('docx', 'word/document.xml', '<!DOCTYPE doc><doc><p><t>Hello</t></p></doc>'),
            ('pptx', 'ppt/slides/slide1.xml', '<!DOCTYPE slide><slide><t>Hello</t></slide>'),
        ]:
            payload = archive([('[Content_Types].xml', '<types/>'), (member, data)])
            # Trusted fault injection tests the parser independently of ZIP validation.
            with patch.object(runner, 'check_office', lambda _: None):
                result = runner.run_job(request('sample.' + suffix, payload, 'document_convert', 'extract'))
            self.assertEqual(result['outcome'], 'failed')
            self.assertEqual(result['artifacts'], [])

    def test_runtime_is_nonroot_and_has_no_tools_or_credentials(self):
        self.assertEqual(os.getuid(), 10001)
        for path in ['/bin/sh', '/usr/bin/curl', '/usr/bin/apt', '/var/run/docker.sock']:
            self.assertFalse(os.path.exists(path), path)
        for key in ['COMPUTE_CONTROL_SECRET', 'AGENT_COMPUTE_SECRET', 'CLOUDFLARE_API_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'ANTHROPIC_API_KEY']:
            self.assertNotIn(key, os.environ)
        with self.assertRaises(OSError):
            with open('/app/mutable', 'w') as stream:
                stream.write('refused')
        import zlib
        self.assertEqual(zlib.ZLIB_RUNTIME_VERSION, '1.4')

    def test_private_http_port_requires_live_context_and_is_one_use(self):
        httpd = server.http.server.HTTPServer(('127.0.0.1', 0), server.Handler)
        port = httpd.server_address[1]
        process = multiprocessing.get_context('fork').Process(target=httpd.serve_forever)
        process.start(); httpd.server_close()
        try:
            def call(claims):
                # Context-only stand-in: cryptographic redemption is tested at the Worker host.
                token = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=') + '.context-only'
                client = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
                client.request('POST', '/run', json.dumps(request()), {'X-Compute-Grant': token})
                response = client.getresponse(); body = json.loads(response.read()); client.close()
                return response.status, body
            future = time.time() * 1000 + 60000  # clock-ok: relative
            self.assertEqual(call({'aud': 'executor.complete', 'exp': future})[0], 403)
            self.assertEqual(call({'aud': 'executor.bootstrap', 'exp': 1})[0], 403)
            status, body = call({'aud': 'executor.bootstrap', 'exp': future})
            self.assertEqual(status, 200); self.assertEqual(body['outcome'], 'succeeded')
            self.assertEqual(call({'aud': 'executor.bootstrap', 'exp': future})[0], 409)
        finally:
            process.terminate(); process.join(5)
            self.assertFalse(process.is_alive())


if __name__ == '__main__': unittest.main(verbosity=2)

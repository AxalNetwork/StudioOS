"""Mutation-check the actual native implementation in memory, never tracked files."""
import io
from pathlib import Path
import types
import unittest
import test_native
from native import NativeZoom

source = Path(__file__).with_name('native.py').read_text()
mutations = [
    ('logs on', 'p.enableLogByDefault = False', 'p.enableLogByDefault = True'),
    ('dumps on', 'p.enableGenerateDump = False', 'p.enableGenerateDump = True'),
    ('camera on', 'q.isVideoOff, q.isAudioOff = True, True', 'q.isVideoOff, q.isAudioOff = False, True'),
    ('mic on', 'q.isVideoOff, q.isAudioOff = True, True', 'q.isVideoOff, q.isAudioOff = True, False'),
    ('missing OBF', 'q.onBehalfToken = args["obfToken"]', 'q.onBehalfToken = ""'),
    ('retained OBF', 'q.onBehalfToken = ""', 'pass'),
    ('late audio', 'if not self.ready or "audio" not in self.enabled:', 'if "audio" not in self.enabled:'),
    ('wrong rate', 'data.GetSampleRate() not in (16000, 32000)', 'False'),
    ('no cleanup', 'z.CleanUPSDK()', 'pass'),
]

def run(cls):
    test_native.NativeZoom = cls
    result = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(test_native.NativeTest))
    return result.wasSuccessful()

assert run(NativeZoom)
for name, before, after in mutations:
    assert before in source, name
    module = types.ModuleType('native_mutant')
    exec(compile(source.replace(before, after, 1), 'native_mutant', 'exec'), module.__dict__)
    assert not run(module.NativeZoom), 'survived: ' + name
    assert run(NativeZoom), 'restore: ' + name
print('9 native mutations caught; restored implementation passes')

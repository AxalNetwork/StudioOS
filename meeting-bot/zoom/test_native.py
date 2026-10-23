"""Native call contract tests: synthetic SDK objects, no SDK import/network."""
import base64
import types
import unittest
from unittest.mock import Mock
from native import NativeZoom


class NativeTest(unittest.TestCase):
    def setUp(self):
        self.events, self.replies = [], []
        self.z = Mock()
        self.z.SDKERR_SUCCESS = 0
        self.z.AUTHRET_SUCCESS = 0
        self.z.InitParam.side_effect = types.SimpleNamespace
        self.z.AuthContext.side_effect = types.SimpleNamespace
        self.z.JoinParam.side_effect = lambda: types.SimpleNamespace(param=types.SimpleNamespace())
        self.z.InitSDK.return_value = 0
        self.service = self.z.CreateMeetingService.return_value
        self.service.SetEvent.return_value = 0
        self.joined = {}
        def joined(p):
            self.joined.update(vars(p.param))
            return 0
        self.service.Join.side_effect = joined
        self.z.CreateAuthService.return_value.SetEvent.return_value = 0
        self.z.CreateAuthService.return_value.SDKAuth.return_value = 0
        self.driver = NativeZoom(self.z, lambda *x: self.events.append(x), lambda *x: self.replies.append(x))
        self.driver.service = self.service
        self.ctrl = self.service.GetMeetingRecordingController.return_value
        self.ctrl.SetEvent.return_value = 0
        self.ctrl.StartRawRecording.return_value = 0
        self.ctrl.RequestLocalRecordingPrivilege.return_value = 0
        self.z.GetAudioRawdataHelper.return_value.subscribe.return_value = 0

    def test_initialize_disables_logs_dumps_and_holds_delegates(self):
        self.driver.command(1, 'initialize', {'jwt': 'synthetic'})
        p = self.z.InitSDK.call_args[0][0]
        self.assertFalse(p.enableGenerateDump)
        self.assertFalse(p.enableLogByDefault)
        self.driver.authenticated(0)
        self.assertEqual(self.replies, [(1, True, None)])
        self.assertEqual(len(self.driver.refs), 2)

    def test_join_uses_obf_once_camera_and_mic_off(self):
        args = dict(meetingId='12345678901', botName='Eadwyn AI', passcode='synthetic', obfToken='synthetic-obf')
        self.driver.command(1, 'join', args)
        q = self.service.Join.call_args[0][0].param
        self.assertEqual(q.meetingNumber, 12345678901)
        self.assertEqual(q.onBehalfToken, '')
        self.assertTrue(q.isVideoOff)
        self.assertTrue(q.isAudioOff)
        self.assertFalse(q.isAudioRawDataStereo)
        self.assertFalse(q.isMyVoiceInMix)
        self.assertEqual(args, {})
        self.assertEqual(self.joined['onBehalfToken'], 'synthetic-obf')
        self.assertEqual(self.joined['userName'], 'Eadwyn AI')
        self.assertEqual(self.joined['psw'], 'synthetic')
        self.ctrl.StartRawRecording.assert_not_called()

    def test_permission_and_revocation_drop_pcm(self):
        self.ctrl.CanStartRawRecording.return_value = 1
        self.driver.command(1, 'recordingAllowed', {})
        self.assertEqual(self.replies[-1], (1, False))
        self.driver.command(2, 'requestRecordingPrivilege', {})
        self.driver.privilege(True)
        self.assertEqual(self.replies[-1], (2, True, None))
        self.driver.command(3, 'startRawRecording', {})
        self.driver.enabled.update(['audio', 'ended'])
        data = Mock()
        data.GetSampleRate.return_value, data.GetChannelNum.return_value = 16000, 1
        data.GetBuffer.return_value = b'\x01\x00'
        self.driver.pcm(data)
        self.assertEqual(self.events[-1], ('audio', base64.b64encode(b'\x01\x00').decode()))
        self.driver.privilege(False)
        self.assertEqual(self.events[-1], ('ended', None))
        count = len(self.events)
        self.driver.pcm(data)
        self.assertEqual(len(self.events), count)
        self.driver.command(4, 'leave', {})
        self.z.GetAudioRawdataHelper.return_value.unSubscribe.assert_called_once()
        self.z.CleanUPSDK.assert_called_once()
        self.assertEqual(self.driver.refs, [])

    def test_wrong_pcm_format_refuses_instead_of_mislabeling(self):
        self.driver.ready = True
        self.driver.enabled.update(['audio', 'ended'])
        data = Mock()
        data.GetSampleRate.return_value = 48000
        data.GetChannelNum.return_value = 1
        data.GetBuffer.return_value = b'\x01\x00'
        self.driver.pcm(data)
        self.assertEqual(self.events, [('ended', None)])
        self.assertFalse(self.driver.ready)


    def test_waiting_room_then_admission_and_sdk_end(self):
        self.driver.command(1, 'join', dict(meetingId='12345678901', botName='Eadwyn AI', passcode='synthetic', obfToken='synthetic-obf'))
        self.driver.status(self.z.MEETING_STATUS_IN_WAITING_ROOM, 0)
        self.assertEqual(self.replies[-1], (1, True, None))
        self.driver.command(2, 'admitted', {})
        self.assertIn('admitted', self.driver.pending)
        ctrl = self.service.GetMeetingParticipantsController.return_value
        ctrl.GetMySelfUser.return_value.GetUserID.return_value = 42
        self.driver.status(self.z.MEETING_STATUS_INMEETING, 0)
        self.assertEqual(self.replies[-1], (2, {'selfKey': '42'}, None))
        self.ctrl.StartRawRecording.assert_not_called()
        self.driver.enabled.add('ended')
        self.driver.status(self.z.MEETING_STATUS_ENDED, 0)
        self.assertEqual(self.events, [('ended', None)])

    def test_roster_renames_and_leaves_keep_stable_keys(self):
        ctrl = self.service.GetMeetingParticipantsController.return_value
        ctrl.GetParticipantsList.return_value = [42]
        ctrl.GetUserByUserID.return_value.GetUserName.return_value = 'Synthetic participant'
        self.driver.roster()
        ctrl.GetUserByUserID.return_value.GetUserName.return_value = 'Synthetic rename'
        self.driver.roster()
        ctrl.GetParticipantsList.return_value = []
        self.driver.roster()
        self.assertEqual(self.events, [
            ('roster', dict(kind='join', key='42', name='Synthetic participant')),
            ('roster', dict(kind='join', key='42', name='Synthetic rename')),
            ('roster', dict(kind='leave', key='42', name='Synthetic rename'))])

    def test_32k_is_resampled_to_16k(self):
        self.driver.ready = True
        self.driver.enabled.add('audio')
        data = Mock()
        data.GetSampleRate.return_value, data.GetChannelNum.return_value = 32000, 1
        data.GetBuffer.return_value = b'\x02\x00\x04\x00\xfe\xff\xfc\xff'
        self.driver.pcm(data)
        self.assertEqual(base64.b64decode(self.events[0][1]), b'\x03\x00\xfd\xff')


if __name__ == '__main__':
    unittest.main()

"""Linux zoom-meeting-sdk bridge. No SDK logging, files, video or model calls."""
import base64
import array
import sys


class NativeZoom:
    def __init__(self, sdk, emit, reply):
        self.z, self.emit, self.reply = sdk, emit, reply
        self.refs = []  # Native delegates must remain alive.
        self.pending = {}
        self.ready = False
        self.ended = False
        self.running = False
        self.people = {}
        self.enabled = set()
        self.service = self.auth = self.helper = None

    def ok(self, result):
        if result != self.z.SDKERR_SUCCESS:
            raise RuntimeError("platform_blocked")

    def delegate(self, value):
        self.refs.append(value)
        return value

    def initialize(self, jwt):
        z = self.z
        p = z.InitParam()
        p.strWebDomain = "https://zoom.us"
        p.strSupportUrl = "https://zoom.us"
        p.enableGenerateDump = False
        p.enableLogByDefault = False
        self.ok(z.InitSDK(p))
        self.service = z.CreateMeetingService()
        self.ok(self.service.SetEvent(self.delegate(z.MeetingServiceEventCallbacks(
            onMeetingStatusChangedCallback=self.status))))
        self.auth = z.CreateAuthService()
        self.ok(self.auth.SetEvent(self.delegate(z.AuthServiceEventCallbacks(
            onAuthenticationReturnCallback=self.authenticated))))
        c = z.AuthContext()
        c.jwt_token = jwt
        self.ok(self.auth.SDKAuth(c))

    def authenticated(self, result):
        self.respond("initialize", result == self.z.AUTHRET_SUCCESS)

    def respond(self, method, value=None, error=None):
        uid = self.pending.pop(method, None)
        if uid is not None:
            self.reply(uid, value, error)

    def status(self, status, result):
        z = self.z
        if status == z.MEETING_STATUS_INMEETING:
            self.running = True
            self.respond("join", True)
            ctrl = self.service.GetMeetingParticipantsController()
            self.self_key = str(ctrl.GetMySelfUser().GetUserID())
            self.respond("admitted", {"selfKey": self.self_key})
        elif status == z.MEETING_STATUS_IN_WAITING_ROOM:
            self.running = True
            self.respond("join", True)
        elif status == z.MEETING_STATUS_FAILED:
            absent = getattr(z, "MEETING_FAIL_AUTHORIZED_USER_NOT_INMEETING", None)
            code = "authorized_user_absent" if absent is not None and result == absent else "refused"
            self.respond("join", error=code)
            self.respond("admitted", error="not_admitted")
        elif self.running and status in (z.MEETING_STATUS_ENDED, z.MEETING_STATUS_IDLE):
            self.end()

    def end(self):
        self.ended = True
        self.ready = False
        self.respond("admitted", error="meeting_ended")
        self.respond("requestRecordingPrivilege", False)
        if "ended" in self.enabled:
            self.emit("ended", None)

    def roster(self):
        ctrl = self.service.GetMeetingParticipantsController()
        current = {str(uid): str(ctrl.GetUserByUserID(uid).GetUserName())[:160]
                   for uid in ctrl.GetParticipantsList()}
        for key, name in self.people.items():
            if key not in current:
                self.emit("roster", {"kind": "leave", "key": key, "name": name})
        for key, name in current.items():
            if self.people.get(key) != name:
                self.emit("roster", {"kind": "join", "key": key, "name": name})
        self.people = current

    def privilege(self, allowed):
        self.respond("requestRecordingPrivilege", bool(allowed))
        if not allowed and self.ready:
            self.end()

    def pcm(self, data):
        if not self.ready or "audio" not in self.enabled:
            return
        # Never reinterpret unsupported rates/channels as canonical PCM.
        if data.GetSampleRate() not in (16000, 32000) or data.GetChannelNum() != 1:
            self.end()
            return
        raw = bytes(data.GetBuffer())
        if len(raw) % 2 or len(raw) > 128000:
            self.end()
            return
        if data.GetSampleRate() == 32000:
            samples = array.array('h')
            samples.frombytes(raw)
            if sys.byteorder != 'little':
                samples.byteswap()
            if len(samples) % 2:
                self.end()
                return
            mono = array.array('h', ((samples[i] + samples[i + 1]) // 2 for i in range(0, len(samples), 2)))
            if sys.byteorder != 'little':
                mono.byteswap()
            raw = mono.tobytes()
        self.emit("audio", base64.b64encode(raw).decode("ascii"))

    def command(self, uid, method, args):
        z = self.z
        if method in ("initialize", "join", "admitted", "requestRecordingPrivilege"):
            if method in self.pending:
                raise RuntimeError("platform_blocked")
            self.pending[method] = uid
        if method == "initialize":
            self.initialize(args["jwt"])
            return
        if method == "join":
            self.ended = False
            p = z.JoinParam()
            p.userType = z.SDKUserType.SDK_UT_WITHOUT_LOGIN
            q = p.param
            q.meetingNumber = int(args["meetingId"])
            q.userName, q.psw = args["botName"], args["passcode"]
            q.onBehalfToken = args["obfToken"]
            q.isVideoOff, q.isAudioOff = True, True
            q.isAudioRawDataStereo, q.isMyVoiceInMix = False, False
            q.eAudioRawdataSamplingRate = z.AudioRawdataSamplingRate.AudioRawdataSamplingRate_32K
            try:
                self.ok(self.service.Join(p))
            finally:
                q.onBehalfToken = ""
                args.clear()
            return
        if method == "admitted":
            if self.service.GetMeetingStatus() == z.MEETING_STATUS_INMEETING:
                self.respond(method, {"selfKey": str(self.service.GetMeetingParticipantsController().GetMySelfUser().GetUserID())})
            return
        if method == "sendChat":
            ctrl = self.service.GetMeetingChatController()
            builder = ctrl.GetChatMessageBuilder()
            try:
                builder.SetContent(args["text"])
                builder.SetReceiver(0)
                builder.SetMessageType(z.SDKChatMessageType.To_All)
                self.ok(ctrl.SendChatMsgTo(builder.Build()))
            finally:
                builder.Clear()
        elif method == "joinAudio":
            self.ok(self.service.GetMeetingAudioController().JoinVoip())
        elif method == "recordingAllowed":
            self.reply(uid, self.service.GetMeetingRecordingController().CanStartRawRecording() == z.SDKERR_SUCCESS)
            return
        elif method == "requestRecordingPrivilege":
            ctrl = self.service.GetMeetingRecordingController()
            self.ok(ctrl.SetEvent(self.delegate(z.MeetingRecordingCtrlEventCallbacks(
                onRecordPrivilegeChangedCallback=self.privilege,
                onLocalRecordingPrivilegeRequestStatusCallback=lambda status: self.respond(
                    "requestRecordingPrivilege", status == z.RequestLocalRecordingStatus.RequestLocalRecording_Granted)))))
            self.ok(ctrl.RequestLocalRecordingPrivilege())
            return
        elif method == "startRawRecording":
            ctrl = self.service.GetMeetingRecordingController()
            # Listen for revocation even when permission was already granted.
            self.ok(ctrl.SetEvent(self.delegate(z.MeetingRecordingCtrlEventCallbacks(
                onRecordPrivilegeChangedCallback=self.privilege))))
            self.ok(ctrl.StartRawRecording())
            self.helper = z.GetAudioRawdataHelper()
            self.ok(self.helper.subscribe(self.delegate(z.ZoomSDKAudioRawDataDelegateCallbacks(
                onMixedAudioRawDataReceivedCallback=self.pcm)), False))
            self.ready = True
        elif method == "subscribe":
            topic = args["topic"]
            self.enabled.add(topic)
            if topic == "ended" and self.ended:
                self.emit("ended", None)
            if topic == "roster":
                self.people = {}
                ctrl = self.service.GetMeetingParticipantsController()
                self.ok(ctrl.SetEvent(self.delegate(z.MeetingParticipantsCtrlEventCallbacks(
                    onUserJoinCallback=lambda *_: self.roster(),
                    onUserLeftCallback=lambda *_: self.roster(),
                    onUserNamesChangedCallback=lambda *_: self.roster()))))
                self.roster()
            elif topic == "speakers":
                ctrl = self.service.GetMeetingAudioController()
                self.ok(ctrl.SetEvent(self.delegate(z.MeetingAudioCtrlEventCallbacks(
                    onUserActiveAudioChangeCallback=lambda ids: self.emit("speakers", {"key": str(ids[0]) if ids else None})))) )
        elif method == "unsubscribe":
            self.enabled.discard(args["topic"])
        elif method == "leave":
            self.ready = False
            self.enabled.clear()
            if self.helper:
                self.helper.unSubscribe()
            if self.service:
                self.service.Leave(z.LEAVE_MEETING)
                z.DestroyMeetingService(self.service)
            if self.auth:
                z.DestroyAuthService(self.auth)
            z.CleanUPSDK()
            self.refs.clear()
        else:
            raise RuntimeError("platform_blocked")
        self.reply(uid, True)

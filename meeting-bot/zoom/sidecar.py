"""One-run private pipe; no native diagnostics on stdout/stderr."""
import json
import os
import threading


def main():
    protocol = os.fdopen(3, 'w', buffering=1)
    null = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null, 1)
    os.dup2(null, 2)
    os.close(null)
    import gi
    gi.require_version('GLib', '2.0')
    from gi.repository import GLib
    import zoom_meeting_sdk as zoom
    from native import NativeZoom
    loop = GLib.MainLoop()
    lock = threading.Lock()
    slots = threading.BoundedSemaphore(32)

    def send(value):
        with lock:
            protocol.write(json.dumps(value, separators=(',', ':')) + '\n')

    def reply(uid, value=None, error=None):
        send(dict(id=uid, value=value, error=error))

    driver = NativeZoom(zoom, lambda event, value: send(dict(event=event, value=value)), reply)

    def command(msg):
        uid = msg.get('id')
        try:
            if not isinstance(uid, int) or not isinstance(msg.get('args'), dict):
                raise ValueError()
            driver.command(uid, msg['method'], msg['args'])
        except Exception:
            driver.pending = {k: v for k, v in driver.pending.items() if v != uid}
            reply(uid, error='platform_blocked')
        finally:
            slots.release()
        if msg.get('method') == 'leave':
            loop.quit()
        return False

    def read():
        with os.fdopen(0, 'rb') as stream:
            while True:
                raw = stream.readline(128 * 1024 + 1)
                if not raw or len(raw) > 128 * 1024:
                    os._exit(1)
                try:
                    msg = json.loads(raw)
                    if not isinstance(msg, dict):
                        raise ValueError()
                except Exception:
                    os._exit(1)
                slots.acquire()
                GLib.idle_add(command, msg)

    threading.Thread(target=read, daemon=True).start()
    loop.run()


if __name__ == '__main__':
    main()

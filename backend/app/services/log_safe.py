"""One value made safe to put in a log line (Code Scanning py/log-injection).

A value a request supplied, or an exception that may quote one, can carry a
carriage return or line feed and forge a second log entry. ``log_safe`` turns
the value into one line: CR and LF are removed and the text is capped, so a
log line still says what it said, never more.
"""


def log_safe(value: object, max_len: int = 500) -> str:
    """``value`` as a single log-safe line, at most ``max_len`` characters."""
    return str(value).replace("\r", "").replace("\n", "")[:max_len]

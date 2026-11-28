"""D8511 — the dev commerce client runs in Stripe test mode only.

`backend/app/services/stripe_commerce.py` reads `STRIPE_TEST_SECRET_KEY` and
`STRIPE_TEST_PUBLISHABLE_KEY` and nothing else. A missing key, a live-mode key,
or `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` set alone is refused before
any request leaves the process, and the error names the variable, never the
value. Every case patches `httpx.Client` and asserts it was never built.

Run: python3 -m unittest backend/tests/test_stripe_test_mode_d8511.py  (or pytest).
CI runs it from frontend/test/stripe_test_mode_d8511.test.mjs. No FastAPI,
database or network needed; where `httpx` is not installed a stand-in module
takes its place, since every case patches `httpx.Client` anyway.
"""
import importlib.util
import os
import pathlib
import sys
import types
from unittest import TestCase, main, mock

try:
    importlib.import_module("httpx")
except ModuleNotFoundError:
    stand_in = types.ModuleType("httpx")

    class HTTPError(Exception):
        pass

    class Client:  # never built: each test patches it
        def __init__(self, *args, **kwargs):
            raise AssertionError("httpx.Client built without a patch")

    stand_in.HTTPError = HTTPError
    stand_in.Client = Client
    sys.modules["httpx"] = stand_in

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("stripe_commerce_d8511", ROOT / "backend/app/services/stripe_commerce.py")
sc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sc)

ALL_KEYS = ("STRIPE_TEST_SECRET_KEY", "STRIPE_SECRET_KEY", "STRIPE_TEST_PUBLISHABLE_KEY", "STRIPE_PUBLISHABLE_KEY")
# Shaped like real keys; not real.
LIVE_SECRET = "sk_live_" + "x" * 24
LIVE_RESTRICTED = "rk_live_" + "x" * 24
TEST_SECRET = "sk_test_" + "y" * 24
LIVE_PUBLISHABLE = "pk_live_" + "x" * 24
TEST_PUBLISHABLE = "pk_test_" + "y" * 24


def _env(**values):
    base = {k: v for k, v in os.environ.items() if k not in ALL_KEYS}
    base.update(values)
    return mock.patch.dict(os.environ, base, clear=True)


class SecretKeyRefusals(TestCase):
    def _refused(self, code, env_name, value=None, **env):
        with _env(**env), mock.patch.object(sc.httpx, "Client") as client:
            with self.assertRaises(sc.StripeError) as caught:
                sc._request("GET", "/products?limit=1")
            client.assert_not_called()
        self.assertEqual(caught.exception.code, code)
        self.assertIn(env_name, caught.exception.message)
        if value:
            self.assertNotIn(value, caught.exception.message)
            self.assertNotIn(value, str(caught.exception))

    def test_missing_key_is_refused_without_a_request(self):
        self._refused("no_key", "STRIPE_TEST_SECRET_KEY")

    def test_live_key_is_refused_without_a_request(self):
        self._refused("not_test_mode", "STRIPE_TEST_SECRET_KEY", LIVE_SECRET, STRIPE_TEST_SECRET_KEY=LIVE_SECRET)

    def test_live_restricted_key_is_refused_without_a_request(self):
        self._refused("not_test_mode", "STRIPE_TEST_SECRET_KEY", LIVE_RESTRICTED, STRIPE_TEST_SECRET_KEY=LIVE_RESTRICTED)

    def test_stripe_secret_key_alone_is_not_a_fallback(self):
        # Even a test-shaped value in STRIPE_SECRET_KEY is not read: the
        # variable itself is off the commerce path.
        self._refused("no_key", "STRIPE_TEST_SECRET_KEY", STRIPE_SECRET_KEY=TEST_SECRET)
        self._refused("no_key", "STRIPE_TEST_SECRET_KEY", LIVE_SECRET, STRIPE_SECRET_KEY=LIVE_SECRET)

    def test_a_test_key_reaches_the_client(self):
        response = mock.Mock(status_code=200)
        response.json.return_value = {"data": []}
        with _env(STRIPE_TEST_SECRET_KEY=TEST_SECRET, STRIPE_SECRET_KEY=LIVE_SECRET), mock.patch.object(sc.httpx, "Client") as client:
            client.return_value.__enter__.return_value.get.return_value = response
            self.assertEqual(sc._request("GET", "/products?limit=1"), {"data": []})
            client.assert_called_once()
            headers = client.return_value.__enter__.return_value.get.call_args.kwargs["headers"]
        self.assertEqual(headers["Authorization"], f"Bearer {TEST_SECRET}")


class PublishableKeyRefusals(TestCase):
    def _refused(self, code, value=None, **env):
        with _env(**env):
            with self.assertRaises(sc.StripeError) as caught:
                sc.publishable_key()
        self.assertEqual(caught.exception.code, code)
        self.assertIn("STRIPE_TEST_PUBLISHABLE_KEY", caught.exception.message)
        if value:
            self.assertNotIn(value, caught.exception.message)

    def test_missing_key_is_refused(self):
        self._refused("no_key")

    def test_live_key_is_refused(self):
        self._refused("not_test_mode", LIVE_PUBLISHABLE, STRIPE_TEST_PUBLISHABLE_KEY=LIVE_PUBLISHABLE)

    def test_stripe_publishable_key_alone_is_not_a_fallback(self):
        self._refused("no_key", STRIPE_PUBLISHABLE_KEY=TEST_PUBLISHABLE)

    def test_a_test_key_is_returned(self):
        with _env(STRIPE_TEST_PUBLISHABLE_KEY=TEST_PUBLISHABLE, STRIPE_PUBLISHABLE_KEY=LIVE_PUBLISHABLE):
            self.assertEqual(sc.publishable_key(), TEST_PUBLISHABLE)


class NoFallbackInTheSource(TestCase):
    def test_the_commerce_client_never_reads_the_live_variables(self):
        source = (ROOT / "backend/app/services/stripe_commerce.py").read_text(encoding="utf-8")
        code = "\n".join(line for line in source.splitlines() if not line.lstrip().startswith("#"))
        # Docstrings may name the variables to say they are not read; reads may not.
        for name in ("STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY"):
            self.assertNotIn(f'"{name}"', code)
            self.assertNotIn(f"'{name}'", code)


if __name__ == "__main__":
    main()
